set local lock_timeout='2s';
set local statement_timeout='30s';

alter table public.leagues add column draft_mode text check(draft_mode in('live','scheduled_auto')),
  add column draft_setup_state text not null default 'unselected' check(draft_setup_state in('unselected','ready','armed','running','blocked','complete')),
  add column draft_block_reason text,
  add column draft_last_processed_at timestamptz not null default 'epoch',
  add column draft_retry_at timestamptz,
  add column draft_attempts integer not null default 0;
alter table public.drafts add column mode text not null default 'live'check(mode in('live','scheduled_auto'));
update public.leagues set draft_mode='live',draft_setup_state=case when status in('active','complete')then'complete'else'ready'end where status<>'setup';
create index automatic_setup_due on public.leagues(draft_scheduled_for,draft_last_processed_at,id)where status='setup'and draft_mode='scheduled_auto'and draft_setup_state='armed';
create index automatic_drafts_running on public.drafts(league_id,id)where mode='scheduled_auto'and status='active'and voided_at is null;

create table beta_private.draft_preferences (
  fantasy_team_id uuid primary key references public.fantasy_teams(id)on delete cascade,
  league_id uuid not null references public.leagues(id)on delete cascade,
  user_id uuid not null references auth.users(id)on delete cascade,
  athlete_ids uuid[] not null default '{}'check(cardinality(athlete_ids)<=500),
  state_version bigint not null default 1,
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);
create index draft_preferences_league on beta_private.draft_preferences(league_id);
create index draft_preferences_user on beta_private.draft_preferences(user_id);
create index draft_preferences_expiry on beta_private.draft_preferences(expires_at)where expires_at is not null;
create table beta_private.draft_preference_snapshots (
  draft_id uuid not null references public.drafts(id)on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id)on delete cascade,
  user_id uuid not null references auth.users(id)on delete cascade,
  athlete_ids uuid[] not null,
  preference_version bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key(draft_id,fantasy_team_id)
);
create index draft_snapshot_user on beta_private.draft_preference_snapshots(user_id);
create index draft_snapshot_team on beta_private.draft_preference_snapshots(fantasy_team_id);
create index draft_snapshot_expiry on beta_private.draft_preference_snapshots(expires_at)where expires_at is not null;
alter table beta_private.draft_preferences enable row level security;
alter table beta_private.draft_preference_snapshots enable row level security;
revoke all on beta_private.draft_preferences,beta_private.draft_preference_snapshots from public,anon,authenticated,service_role;

-- - Clone the reviewed implementations without changing existing function identities or grants
-- - Only trusted worker calls can bypass the human actor and command receipt checks
do $prepare$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('rpc_private.start_draft(uuid,integer,integer,text)'::regprocedure);
  if position('No eligible regular-season periods remain' in definition)=0 then raise exception 'Expected late-draft guard';end if;
  definition:=replace(definition,'rpc_private.start_draft(','beta_private.start_draft_checked(');
  definition:=replace(definition,'perform rpc_private.require_app_access();','if coalesce(auth.jwt()->>''role'','''')<>''service_role''then perform rpc_private.require_app_access();end if;');
  anchor:='existing:=beta_private.begin_command(''start_draft'',p_idempotency_key); if existing is not null then return existing; end if;';
  if position(anchor in definition)=0 then raise exception 'Expected draft receipt guard';end if;
  definition:=replace(definition,anchor,'if coalesce(auth.jwt()->>''role'','''')<>''service_role''then '||anchor||'end if;');
  definition:=replace(definition,'if not public.is_league_commissioner(l.id) then','if coalesce(auth.jwt()->>''role'','''')<>''service_role''and not public.is_league_commissioner(l.id) then');
  anchor:='return beta_private.finish_command(''start_draft'',p_idempotency_key,jsonb_build_object(''draft_id'',d,''state_version'',1));';
  if position(anchor in definition)=0 then raise exception 'Expected draft result guard';end if;
  definition:=replace(definition,anchor,'if coalesce(auth.jwt()->>''role'','''')=''service_role''then return jsonb_build_object(''draft_id'',d,''state_version'',1);end if;'||anchor);
  execute definition;
  definition:=pg_get_functiondef('rpc_private.schedule_league_draft(uuid,timestamp with time zone,bigint,text)'::regprocedure);
  definition:=replace(definition,'rpc_private.schedule_league_draft(','beta_private.schedule_draft_checked(');
  definition:=replace(definition,'exists(select 1 from public.drafts where league_id=l.id)','exists(select 1 from public.drafts where league_id=l.id and voided_at is null)');
  execute definition;
end;
$prepare$;
revoke all on function beta_private.start_draft_checked(uuid,integer,integer,text),beta_private.schedule_draft_checked(uuid,timestamptz,bigint,text)from public,anon,authenticated,service_role;

create function rpc_private.configure_league_draft(p_league_id uuid,p_mode text,p_scheduled_for timestamptz,p_expected_version bigint,p_idempotency_key text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.leagues%rowtype; receipt jsonb; result jsonb;
begin
  perform rpc_private.require_app_access();
  receipt:=beta_private.begin_command('configure_league_draft',p_idempotency_key);if receipt is not null then return receipt;end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id for update;
  if l.id is null or not public.is_league_commissioner(l.id)then raise exception 'Commissioner access required'using errcode='42501';end if;
  if l.pool_id is null or l.status<>'setup'or exists(select 1 from public.drafts where league_id=l.id and voided_at is null)then raise exception 'Draft setup can only change before the draft starts'using errcode='22023';end if;
  if p_expected_version is distinct from l.state_version then raise exception 'League changed; refresh and retry'using errcode='PT409';end if;
  if p_mode is null or p_mode not in('live','scheduled_auto')then raise exception 'Choose Live draft or Scheduled automatic draft'using errcode='22023';end if;
  if l.draft_mode='scheduled_auto'and l.draft_setup_state='armed'and l.draft_scheduled_for<=clock_timestamp()then raise exception 'The draft cutoff has passed; wait for its status before changing setup'using errcode='PT409';end if;
  if p_mode='scheduled_auto'and not(select automatic_drafts_enabled from beta_private.release_controls)then raise exception 'Automatic drafting is not enabled yet'using errcode='22023';end if;
  if p_mode='scheduled_auto'and p_scheduled_for is null then raise exception 'Choose a future automatic draft date and time'using errcode='22023';end if;
  update public.leagues set draft_mode=p_mode,draft_setup_state=case when p_mode='scheduled_auto'then'armed'else'ready'end,draft_block_reason=null,draft_retry_at=null,draft_attempts=0 where id=l.id;
  update beta_private.draft_preferences set expires_at=case when p_mode='scheduled_auto'then null else clock_timestamp()+interval '30 days'end where league_id=l.id;
  result:=beta_private.schedule_draft_checked(l.id,p_scheduled_for,p_expected_version,p_idempotency_key);
  update public.notifications set body=case when p_mode='scheduled_auto'then'The system will start drafting at the scheduled time. Save private rankings before the cutoff; approved legal defaults cover missing choices.'else'Your commissioner updated the planned draft time. The commissioner will start the live draft manually.'end,
    data=data||jsonb_build_object('mode',p_mode)
  where kind='draft_schedule_changed'and data->>'league_id'=l.id::text and data->>'schedule_version'=(select draft_schedule_version::text from public.leagues where id=l.id);
  perform beta_private.audit('draft.mode_selected','league',l.id::text,jsonb_build_object('mode',l.draft_mode),jsonb_build_object('mode',p_mode,'scheduled_for',p_scheduled_for),p_idempotency_key);
  return beta_private.finish_command('configure_league_draft',p_idempotency_key,result||jsonb_build_object('mode',p_mode));
end;
$$;

create or replace function rpc_private.schedule_league_draft(p_league_id uuid,p_scheduled_for timestamptz,p_expected_version bigint,p_idempotency_key text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.leagues%rowtype; receipt jsonb;
begin
  perform rpc_private.require_app_access();
  receipt:=beta_private.begin_command('schedule_league_draft',p_idempotency_key);if receipt is not null then return receipt;end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id;
  if not public.is_league_commissioner(l.id)then raise exception 'Commissioner access required'using errcode='42501';end if;
  if l.draft_mode is null and(select mode_selection_required from beta_private.release_controls)then raise exception 'Select a draft mode before scheduling'using errcode='22023';end if;
  if l.draft_mode='scheduled_auto'then return rpc_private.configure_league_draft(l.id,l.draft_mode,p_scheduled_for,p_expected_version,p_idempotency_key);end if;
  return beta_private.schedule_draft_checked(p_league_id,p_scheduled_for,p_expected_version,p_idempotency_key);
end;
$$;

create or replace function rpc_private.start_draft(p_league_id uuid,p_rounds integer,p_pick_seconds integer,p_idempotency_key text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.leagues%rowtype; receipt jsonb;
begin
  perform rpc_private.require_app_access();
  receipt:=beta_private.begin_command('start_draft',p_idempotency_key);if receipt is not null then return receipt;end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id;
  if not public.is_league_commissioner(l.id)then raise exception 'Commissioner access required';end if;
  if l.draft_mode='scheduled_auto'then raise exception 'The system starts this draft at its scheduled time'using errcode='22023';end if;
  if l.pool_id is not null and l.draft_mode is null and(select mode_selection_required from beta_private.release_controls)then raise exception 'Select a draft mode before starting'using errcode='22023';end if;
  return beta_private.start_draft_checked(p_league_id,p_rounds,p_pick_seconds,p_idempotency_key);
end;
$$;

create function rpc_private.get_league_draft_setup(p_league_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare l public.leagues%rowtype; team uuid; preference beta_private.draft_preferences%rowtype;
begin
  perform rpc_private.require_app_access();
  if not public.is_league_member(p_league_id)then raise exception 'League membership required'using errcode='42501';end if;
  select * into l from public.leagues where id=p_league_id;
  select id into team from public.fantasy_teams where league_id=l.id and owner_id=auth.uid();
  select * into preference from beta_private.draft_preferences where fantasy_team_id=team and user_id=auth.uid()and(expires_at is null or expires_at>now());
  return jsonb_build_object('mode',l.draft_mode,'status',l.draft_setup_state,'blockReason',l.draft_block_reason,'scheduledFor',l.draft_scheduled_for,
    'leagueVersion',l.state_version,'serverTime',clock_timestamp(),'automaticEnabled',(select automatic_drafts_enabled from beta_private.release_controls),
    'myTeamId',team,'preferenceVersion',coalesce(preference.state_version,0),'preferences',coalesce(to_jsonb(preference.athlete_ids),'[]'),
    'editable',team is not null and l.status='setup'and l.draft_mode='scheduled_auto'and l.draft_scheduled_for>clock_timestamp(),
    'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',ft.id,'name',ft.name,'prepared',coalesce(cardinality(p.athlete_ids)>0,false))order by ft.name),'[]')from public.fantasy_teams ft left join beta_private.draft_preferences p on p.fantasy_team_id=ft.id and p.user_id=ft.owner_id where ft.league_id=l.id),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'displayName',a.display_name,'positions',s.positions,'program',c.name,'rank',r.rank,'bio',a.bio,'eligibleForMe',team is not null and beta_private.can_acquire_athlete(team,a.id))order by r.rank,a.id),'[]')
      from public.player_pools pool join public.pool_competitions pc on pc.pool_id=pool.id
      join public.athlete_seasons s on s.competition_id=pc.competition_id and s.season_id=pool.season_id and s.draft_eligible
      join public.athletes a on a.id=s.athlete_id and a.status='active'and a.fantasy_withdrawn_at is null
      join public.pool_rankings r on r.pool_id=pool.id and r.athlete_id=a.id and r.reviewed
      join public.competitions c on c.id=s.competition_id where pool.id=l.pool_id));
end;
$$;

create function rpc_private.save_draft_preferences(p_league_id uuid,p_athlete_ids uuid[],p_expected_version bigint,p_idempotency_key text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.leagues%rowtype; team uuid; version bigint; receipt jsonb;
begin
  perform rpc_private.require_app_access();
  receipt:=beta_private.begin_command('save_draft_preferences',p_idempotency_key);if receipt is not null then return receipt;end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id for update;
  select id into team from public.fantasy_teams where league_id=l.id and owner_id=auth.uid();
  if team is null then raise exception 'Team ownership required'using errcode='42501';end if;
  if l.status<>'setup'or l.draft_mode is distinct from 'scheduled_auto'or l.draft_scheduled_for is null or l.draft_scheduled_for<=clock_timestamp()then raise exception 'Preference editing is closed'using errcode='22023';end if;
  select state_version into version from beta_private.draft_preferences where fantasy_team_id=team and user_id=auth.uid();
  if p_expected_version is distinct from coalesce(version,0)then raise exception 'Preferences changed; reload before saving'using errcode='PT409';end if;
  if p_athlete_ids is null or cardinality(p_athlete_ids)>500 or cardinality(p_athlete_ids)<>(select count(distinct id)from unnest(p_athlete_ids)id)
    or exists(select 1 from unnest(p_athlete_ids)id where not exists(select 1 from public.pool_rankings r where r.pool_id=l.pool_id and r.athlete_id=id and r.reviewed))then raise exception 'Choose distinct athletes from the approved player pool'using errcode='22023';end if;
  insert into beta_private.draft_preferences(fantasy_team_id,league_id,user_id,athlete_ids)values(team,l.id,auth.uid(),p_athlete_ids)
  on conflict(fantasy_team_id)do update set user_id=excluded.user_id,athlete_ids=excluded.athlete_ids,state_version=beta_private.draft_preferences.state_version+1,updated_at=clock_timestamp(),expires_at=null
  returning state_version into version;
  return beta_private.finish_command('save_draft_preferences',p_idempotency_key,jsonb_build_object('version',version,'count',cardinality(p_athlete_ids)));
end;
$$;

create function public.configure_league_draft(p_league_id uuid,p_mode text,p_scheduled_for timestamptz,p_expected_version bigint,p_idempotency_key text)returns jsonb language sql security invoker set search_path=''as $$select rpc_private.configure_league_draft(p_league_id,p_mode,p_scheduled_for,p_expected_version,p_idempotency_key);$$;
create function public.get_league_draft_setup(p_league_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$select rpc_private.get_league_draft_setup(p_league_id);$$;
create function public.save_draft_preferences(p_league_id uuid,p_athlete_ids uuid[],p_expected_version bigint,p_idempotency_key text)returns jsonb language sql security invoker set search_path=''as $$select rpc_private.save_draft_preferences(p_league_id,p_athlete_ids,p_expected_version,p_idempotency_key);$$;
revoke all on function public.configure_league_draft(uuid,text,timestamptz,bigint,text),public.get_league_draft_setup(uuid),public.save_draft_preferences(uuid,uuid[],bigint,text),rpc_private.configure_league_draft(uuid,text,timestamptz,bigint,text),rpc_private.get_league_draft_setup(uuid),rpc_private.save_draft_preferences(uuid,uuid[],bigint,text)from public,anon,authenticated,service_role;
grant execute on function public.configure_league_draft(uuid,text,timestamptz,bigint,text),public.get_league_draft_setup(uuid),public.save_draft_preferences(uuid,uuid[],bigint,text),rpc_private.configure_league_draft(uuid,text,timestamptz,bigint,text),rpc_private.get_league_draft_setup(uuid),rpc_private.save_draft_preferences(uuid,uuid[],bigint,text)to authenticated;

create function beta_private.snapshot_draft_mode()returns trigger language plpgsql security definer set search_path=''as $$
begin
  select coalesce(draft_mode,'live')into new.mode from public.leagues where id=new.league_id;
  return new;
end;
$$;
revoke all on function beta_private.snapshot_draft_mode()from public,anon,authenticated,service_role;
create trigger snapshot_draft_mode before insert on public.drafts for each row execute function beta_private.snapshot_draft_mode();

create function beta_private.automatic_draft_notice(p_league_id uuid,p_kind text,p_title text,p_body text,p_dedupe text,p_draft_id uuid default null)returns void
language sql security definer set search_path=''as $$
insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
select m.user_id,p_kind,p_title,p_body,jsonb_build_object('league_id',p_league_id,'draft_id',p_draft_id),p_dedupe||':'||m.user_id
from public.league_members m join public.profiles p on p.id=m.user_id and p.deleted_at is null
where m.league_id=p_league_id on conflict do nothing;
$$;
revoke all on function beta_private.automatic_draft_notice(uuid,text,text,text,text,uuid)from public,anon,authenticated,service_role;

create function beta_private.finish_automatic_draft()returns trigger
language plpgsql security definer set search_path=''as $$
begin
  if new.mode<>'scheduled_auto'then return new;end if;
  if new.voided_at is not null and old.voided_at is null then
    update beta_private.draft_preference_snapshots set expires_at=clock_timestamp()+interval '30 days'where draft_id=new.id;
    delete from beta_private.draft_preferences where league_id=new.league_id;
    update public.leagues set draft_mode=null,draft_setup_state='unselected',draft_scheduled_for=null,draft_block_reason=null,draft_attempts=0,draft_retry_at=null where id=new.league_id;
  elsif new.status='complete'and old.status<>'complete'then
    update beta_private.draft_preference_snapshots set expires_at=new.completed_at+interval '30 days'where draft_id=new.id;
    update beta_private.draft_preferences set expires_at=new.completed_at+interval '30 days'where league_id=new.league_id;
    update public.leagues set draft_setup_state='complete',draft_block_reason=null where id=new.league_id;
    perform beta_private.automatic_draft_notice(new.league_id,'draft_completed','Automatic draft complete','Your team is drafted. Open your league to review results and scoring-period eligibility.','automatic-complete:'||new.id,new.id);
  end if;
  return new;
end;
$$;
revoke all on function beta_private.finish_automatic_draft()from public,anon,authenticated,service_role;
create trigger automatic_draft_finished after update of status,voided_at on public.drafts for each row execute function beta_private.finish_automatic_draft();

-- - Use the same legal-roster transaction for every pick and record actual completion time
do $guards$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('rpc_private.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint)'::regprocedure);
  anchor:='select * into d from public.drafts where id=p_draft_id;';
  if position(anchor in definition)=0 then raise exception 'Expected canonical pick lookup';end if;
  definition:=replace(definition,anchor,anchor||'if d.mode=''scheduled_auto''and p_source<>''autopick''then if not public.is_league_member(d.league_id)then raise exception ''Draft membership required''using errcode=''42501'';end if;raise exception ''The system makes picks in automatic mode''using errcode=''22023'';end if;');
  anchor:='completed_at=case when d.current_overall_pick=n*10 then now() end';
  if position(anchor in definition)=0 then raise exception 'Expected final-pick completion clock';end if;
  definition:=replace(definition,anchor,'completed_at=case when d.current_overall_pick=n*10 then clock_timestamp() end');
  execute definition;
  definition:=pg_get_functiondef('rpc_private.set_draft_queue(uuid,uuid[],text)'::regprocedure);
  anchor:='select * into d from public.drafts where id=p_draft_id;';
  if position(anchor in definition)=0 then raise exception 'Expected queue lookup';end if;
  execute replace(definition,anchor,anchor||'if d.mode=''scheduled_auto''then if not public.is_league_member(d.league_id)then raise exception ''Draft membership required''using errcode=''42501'';end if;raise exception ''Automatic draft preferences are frozen at the scheduled cutoff''using errcode=''22023'';end if;');
  definition:=pg_get_functiondef('rpc_private.process_expired_drafts_serial(integer)'::regprocedure);
  anchor:='dr.status=''active''';
  if position(anchor in definition)=0 then raise exception 'Expected live worker filter';end if;
  execute replace(definition,anchor,'dr.mode=''live''and '||anchor);
end;
$guards$;

create function beta_private.process_automatic_drafts(p_limit integer default 25)returns jsonb
language plpgsql security definer set search_path=''as $$
declare candidate record;l public.leagues%rowtype;d public.drafts%rowtype;started timestamptz:=clock_timestamp();claims text:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}');
  result jsonb;team uuid;athlete uuid;pick record;preference boolean;round_number integer;turn integer;count_picks integer:=0;count_started integer:=0;count_blocked integer:=0;attempt integer;batch_picks integer;batch_started integer;
begin
  perform beta_private.require_worker();
  if p_limit not between 1 and 25 then raise exception 'Invalid batch limit'using errcode='22023';end if;
  perform set_config('request.jwt.claims',(claims::jsonb||'{"role":"service_role"}')::text,true);
  for candidate in
    select league.id from public.leagues league where league.draft_mode='scheduled_auto'
      and(league.draft_retry_at is null or league.draft_retry_at<=clock_timestamp())
      and((league.status='setup'and league.draft_setup_state='armed'and league.draft_scheduled_for<=clock_timestamp()and(select automatic_drafts_enabled from beta_private.release_controls))
        or(league.status='drafting'and exists(select 1 from public.drafts dr where dr.league_id=league.id and dr.mode='scheduled_auto'and dr.status='active'and dr.voided_at is null)))
    order by league.draft_last_processed_at,league.id limit p_limit
  loop
    exit when clock_timestamp()-started>=interval '5 seconds';
    if not pg_try_advisory_xact_lock(hashtextextended('beta-league:'||candidate.id::text,0))then continue;end if;
    select * into l from public.leagues where id=candidate.id for update;
    update public.leagues set draft_last_processed_at=clock_timestamp()where id=l.id;
    batch_picks:=0;batch_started:=0;
    begin
      if l.status='setup'and l.draft_setup_state='armed'and l.draft_scheduled_for<=clock_timestamp()then
        result:=beta_private.start_draft_checked(l.id,10,coalesce(l.draft_pick_seconds,120),'automatic-start:'||l.id||':'||l.draft_schedule_version);
        select * into d from public.drafts where id=(result->>'draft_id')::uuid;
        insert into beta_private.draft_preference_snapshots(draft_id,fantasy_team_id,user_id,athlete_ids,preference_version)
        select d.id,ft.id,ft.owner_id,coalesce(p.athlete_ids,'{}'),coalesce(p.state_version,0)
        from public.fantasy_teams ft left join beta_private.draft_preferences p on p.fantasy_team_id=ft.id and p.user_id=ft.owner_id
        where ft.league_id=l.id;
        update public.leagues set draft_setup_state='running',draft_attempts=0,draft_retry_at=null where id=l.id;
        batch_started:=1;
      end if;
      for attempt in 1..5 loop
        exit when clock_timestamp()-started>=interval '5 seconds';
        select * into d from public.drafts where league_id=l.id and status='active'and mode='scheduled_auto'and voided_at is null for update;
        exit when d.id is null;
        round_number:=((d.current_overall_pick-1)/cardinality(d.team_order))+1;
        turn:=((d.current_overall_pick-1)%cardinality(d.team_order))+1;
        team:=d.team_order[case when round_number%2=0 then cardinality(d.team_order)-turn+1 else turn end];
        athlete:=null;preference:=false;
        for pick in select ids.id from beta_private.draft_preference_snapshots s cross join lateral unnest(s.athlete_ids)with ordinality ids(id,priority)
          where s.draft_id=d.id and s.fantasy_team_id=team order by ids.priority
        loop
          if not exists(select 1 from public.roster_entries where league_id=l.id and athlete_id=pick.id and released_at is null)
            and beta_private.draft_completion(l.id,pick.id,team)is not null then athlete:=pick.id;preference:=true;exit;end if;
        end loop;
        if athlete is null then
          for pick in select (r->>'athlete_id')::uuid id from jsonb_array_elements(d.rankings_snapshot)r order by(r->>'rank')::integer
          loop
            if not exists(select 1 from public.roster_entries where league_id=l.id and athlete_id=pick.id and released_at is null)
              and beta_private.draft_completion(l.id,pick.id,team)is not null then athlete:=pick.id;exit;end if;
          end loop;
        end if;
        if athlete is null then
          update public.drafts set status='paused',pick_deadline=null,state_version=state_version+1 where id=d.id;
          update public.leagues set draft_block_reason='No legal athlete remains; review the player pool before resuming'where id=l.id;
          perform beta_private.automatic_draft_notice(l.id,'draft_automatic_paused','Automatic draft paused','The system found no legal next pick. Your commissioner must review the player pool before resuming.','automatic-paused:'||d.id||':'||d.state_version,d.id);
          exit;
        end if;
        update public.drafts set pick_deadline=clock_timestamp()where id=d.id;
        result:=rpc_private.make_draft_pick(d.id,athlete,'autopick:'||d.id||':'||d.current_overall_pick,'autopick',d.state_version);
        perform beta_private.audit('draft.automatic_pick','draft',d.id::text,null,jsonb_build_object('pick',d.current_overall_pick,'selection',case when preference then'manager_preference'else'approved_default'end),'automatic-pick:'||d.id||':'||d.current_overall_pick);
        batch_picks:=batch_picks+1;
      end loop;
      update public.leagues set draft_attempts=0,draft_retry_at=null where id=l.id;
      count_started:=count_started+batch_started;count_picks:=count_picks+batch_picks;
    exception when others then
      -- - A failed league batch rolls back independently and never retries a validation denial
      if sqlstate like '40%'or sqlstate in('55P03','53300','57P03')then
        update public.leagues set draft_attempts=draft_attempts+1,draft_retry_at=clock_timestamp()+make_interval(secs=>least(900,15*(2^draft_attempts)::integer))where id=l.id returning draft_attempts into attempt;
        if attempt<5 then continue;end if;
      end if;
      if l.status='setup'then
        update public.leagues set draft_setup_state='blocked',draft_block_reason=case
          when sqlerrm in('All manager places must be filled','Approved player pool and rankings required','Player pool cannot fill legal rosters for every team','Every eligible athlete requires a reviewed rank','No eligible regular-season periods remain for a new draft')then sqlerrm
          else'Automatic draft could not start; review league setup and choose a new future time'end,draft_retry_at=null where id=l.id;
        perform beta_private.automatic_draft_notice(l.id,'draft_blocked','Automatic draft needs attention','No picks were committed. Your commissioner must fix league setup and choose a new future draft time.','automatic-blocked:'||l.id||':'||l.draft_schedule_version);
      else
        update public.drafts set status='paused',pick_deadline=null,state_version=state_version+1 where league_id=l.id and status='active'and voided_at is null;
        update public.leagues set draft_block_reason='Automatic drafting paused after a processing failure; contact support',draft_retry_at=null where id=l.id;
        perform beta_private.automatic_draft_notice(l.id,'draft_automatic_paused','Automatic draft paused','Committed picks are preserved. Contact support before resuming.','automatic-error:'||l.id||':'||l.draft_schedule_version);
      end if;
      count_blocked:=count_blocked+1;
    end;
  end loop;
  perform set_config('request.jwt.claims',claims,true);
  return jsonb_build_object('started',count_started,'picks',count_picks,'blocked',count_blocked);
end;
$$;
revoke all on function beta_private.process_automatic_drafts(integer)from public,anon,authenticated,service_role;

create or replace function rpc_private.process_expired_drafts(p_limit integer default 25)returns jsonb
language plpgsql security definer set search_path=''as $$
declare live_result jsonb;automatic_result jsonb;
begin
  perform beta_private.require_worker();
  if p_limit not between 1 and 100 then raise exception 'Invalid limit'using errcode='22023';end if;
  if not pg_try_advisory_xact_lock(hashtextextended('brock-draft-worker',0))then return jsonb_build_object('processed',0,'busy',true);end if;
  live_result:=rpc_private.process_expired_drafts_serial(p_limit);
  automatic_result:=beta_private.process_automatic_drafts(least(p_limit,25));
  return live_result||jsonb_build_object('automatic',automatic_result);
end;
$$;

create function rpc_private.admin_get_draft_preferences(p_draft_id uuid,p_fantasy_team_id uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare result jsonb;
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin()then raise exception 'Administrator MFA required'using errcode='42501';end if;
  if p_reason is null or length(btrim(p_reason))not between 8 and 500 then raise exception 'Record the support reason'using errcode='22023';end if;
  select jsonb_build_object('athleteIds',athlete_ids,'version',preference_version,'expiresAt',expires_at)into result
  from beta_private.draft_preference_snapshots where draft_id=p_draft_id and fantasy_team_id=p_fantasy_team_id and(expires_at is null or expires_at>clock_timestamp());
  perform beta_private.audit('privacy.draft_preferences_accessed','draft',p_draft_id::text,null,jsonb_build_object('team_id',p_fantasy_team_id,'reason',btrim(p_reason)));
  return result;
end;
$$;
create function public.admin_get_draft_preferences(p_draft_id uuid,p_fantasy_team_id uuid,p_reason text)returns jsonb language sql security invoker set search_path=''as $$select rpc_private.admin_get_draft_preferences(p_draft_id,p_fantasy_team_id,p_reason);$$;
revoke all on function public.admin_get_draft_preferences(uuid,uuid,text),rpc_private.admin_get_draft_preferences(uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.admin_get_draft_preferences(uuid,uuid,text),rpc_private.admin_get_draft_preferences(uuid,uuid,text)to authenticated;

notify pgrst,'reload schema';
