-- - Record participation once at signup and allow audited administrator corrections
alter table public.profiles add column is_varsity boolean not null default false;
revoke update on public.profiles from authenticated;
grant update(display_name,avatar_url) on public.profiles to authenticated;
create policy profiles_own_read on public.profiles for select to authenticated using(id=(select auth.uid()));

create table beta_private.account_participation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check(role in ('none','athlete','coach','athlete_coach')),
  programs text[] not null default '{}',
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  check(programs <@ array['mens_hockey','womens_hockey','mens_basketball','womens_basketball','mens_volleyball','womens_volleyball']),
  check(array_position(programs,null) is null),
  check((role='none' and cardinality(programs)=0) or (role<>'none' and cardinality(programs) between 1 and 6))
);
alter table beta_private.account_participation enable row level security;
revoke all on beta_private.account_participation from public,anon,authenticated,service_role;
insert into beta_private.account_participation(user_id,role) select id,'none' from public.profiles;

create table beta_private.account_participation_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  revision bigint not null,
  role text not null,
  programs text[] not null,
  effective_at timestamptz not null,
  primary key(user_id,revision)
);
create index participation_history_at on beta_private.account_participation_history(user_id,effective_at desc,revision desc);
alter table beta_private.account_participation_history enable row level security;
revoke all on beta_private.account_participation_history from public,anon,authenticated,service_role;
insert into beta_private.account_participation_history select user_id,revision,role,programs,updated_at from beta_private.account_participation;

alter table public.leagues add column roster_format text not null default 'standard' check(roster_format in ('standard','varsity'));
create table beta_private.varsity_rulesets (
  standard_id uuid primary key references public.scoring_rulesets(id),
  varsity_id uuid not null unique references public.scoring_rulesets(id)
);
alter table beta_private.varsity_rulesets enable row level security;
revoke all on beta_private.varsity_rulesets from public,anon,authenticated,service_role;

create function beta_private.adopt_varsity_format(league uuid) returns void
language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; varsity uuid;
begin
  perform beta_private.league_lock(league);
  select * into l from public.leagues where id=league for update;
  if l.pool_id is null or l.roster_format='varsity' or not exists(
    select 1 from public.league_members m join beta_private.account_participation a on a.user_id=m.user_id
    where m.league_id=league and a.role<>'none'
  ) then return; end if;
  -- - Serialize template creation when different leagues share a scoring ruleset
  perform pg_advisory_xact_lock(hashtextextended('varsity-ruleset:'||l.ruleset_id::text,0));
  select varsity_id into varsity from beta_private.varsity_rulesets where standard_id=l.ruleset_id;
  if varsity is null then
    varsity:=gen_random_uuid();
    insert into public.scoring_rulesets(id,sport,name,version,status,draft_config,transaction_config,matchup_config,approved_by,approved_at)
    select varsity,sport,name||' (varsity '||id::text||')',version,status,draft_config,transaction_config,matchup_config,approved_by,approved_at
    from public.scoring_rulesets where id=l.ruleset_id;
    insert into public.scoring_rules(ruleset_id,stat_key,label,points,sort_order)
    select varsity,stat_key,label,points,sort_order from public.scoring_rules where ruleset_id=l.ruleset_id;
    insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
    select varsity,slot_code,
      case when slot_code in ('HK_F','HK_DG') then 'Hockey - any position'
        when slot_code in ('BB_BC','BB_FC') then 'Basketball - any position'
        when slot_code in ('VB_HT','VB_LS') then 'Volleyball - any position' else label end,
      case when slot_code in ('HK_F','HK_DG') then array['F','D','G']
        when slot_code in ('BB_BC','BB_FC') then array['BC','FC']
        when slot_code in ('VB_HT','VB_LS') then array['HT','L','S'] else allowed_positions end,
      slot_count,is_starter from public.roster_slot_rules where ruleset_id=l.ruleset_id;
    insert into beta_private.varsity_rulesets values(l.ruleset_id,varsity);
  end if;
  -- - Keep existing assignments and earned points because every standard slot remains eligible
  update public.leagues set ruleset_id=varsity,roster_format='varsity',state_version=state_version+1 where id=league;
  perform beta_private.audit('league.varsity_format','league',league::text,null,jsonb_build_object('ruleset_id',varsity));
end;
$$;

create function beta_private.participation_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare league uuid;
begin
  insert into beta_private.account_participation_history(user_id,revision,role,programs,effective_at)
  values(new.user_id,new.revision,new.role,new.programs,new.updated_at);
  update public.profiles set is_varsity=(new.role<>'none') where id=new.user_id;
  -- - Lock affected leagues in a stable order to serialize corrections with picks and moves
  for league in select league_id from public.league_members where user_id=new.user_id order by league_id loop
    perform beta_private.adopt_varsity_format(league);
    update public.leagues set state_version=state_version+1 where id=league;
  end loop;
  return new;
end;
$$;
create trigger participation_changed after insert or update of role,programs,revision on beta_private.account_participation
for each row execute function beta_private.participation_changed();

create function beta_private.member_varsity_format() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_when='BEFORE' then
    -- - Serialize membership changes with participation corrections before acquiring league locks
    perform 1 from beta_private.account_participation where user_id=new.user_id for share;
  else perform beta_private.adopt_varsity_format(new.league_id); end if;
  return new;
end;
$$;
create trigger lock_member_participation before insert or update of user_id on public.league_members
for each row execute function beta_private.member_varsity_format();
create trigger member_varsity_format after insert or update of user_id on public.league_members
for each row execute function beta_private.member_varsity_format();

create function beta_private.record_signup_participation() returns trigger
language plpgsql security definer set search_path='' as $$
declare participant_role text:=new.raw_user_meta_data->>'varsity_role'; programs text[]; full_name text:=btrim(new.raw_user_meta_data->>'display_name');
begin
  if full_name is null or char_length(full_name) not between 1 and 60 then raise exception 'Full name is required' using errcode='22023'; end if;
  if participant_role is null or participant_role not in ('none','athlete','coach','athlete_coach')
    or jsonb_typeof(new.raw_user_meta_data->'varsity_programs') is distinct from 'array' then
    raise exception 'Varsity participation selection is required' using errcode='22023';
  end if;
  select coalesce(array_agg(value),'{}') into programs from jsonb_array_elements_text(new.raw_user_meta_data->'varsity_programs');
  if cardinality(programs)<>(select count(distinct p) from unnest(programs) p) then raise exception 'Duplicate varsity programs' using errcode='22023'; end if;
  update public.profiles set display_name=full_name where id=new.id;
  insert into beta_private.account_participation(user_id,role,programs) values(new.id,participant_role,programs);
  return new;
end;
$$;
create trigger zz_record_signup_participation after insert on auth.users for each row execute function beta_private.record_signup_participation();

-- - Program affiliations impose restrictions and never grant application or staff access
create function beta_private.can_acquire_athlete(team uuid,athlete uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(
    select 1 from public.fantasy_teams t join beta_private.account_participation p on p.user_id=t.owner_id
    join public.athletes a on a.id=athlete
    join public.competitions c on c.id=a.competition_id
    join public.sports sport on sport.id=c.sport_id
    join public.teams actual_team on actual_team.id=a.team_id and actual_team.is_brock
    where t.id=team and p.role<>'none' and (c.division::text||'_'||sport.code::text)=any(p.programs)
  );
$$;

-- - Evaluate game eligibility at scheduled start so later corrections cannot rewrite scoring history
create function beta_private.can_field_athlete(team uuid,athlete uuid,at_time timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(
    select 1 from public.fantasy_teams ft
    cross join lateral (select h.role,h.programs from beta_private.account_participation_history h
      where h.user_id=ft.owner_id and h.effective_at<=at_time order by h.effective_at desc,h.revision desc limit 1) participation
    join public.athletes a on a.id=athlete
    join public.competitions c on c.id=a.competition_id
    join public.sports sport on sport.id=c.sport_id
    join public.teams actual_team on actual_team.id=a.team_id and actual_team.is_brock
    where ft.id=team and participation.role<>'none' and (c.division::text||'_'||sport.code::text)=any(participation.programs)
  );
$$;
revoke all on function beta_private.can_field_athlete(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
create function beta_private.enforce_participant_acquisition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform beta_private.league_lock(new.league_id);
  if new.released_at is null and not beta_private.can_acquire_athlete(new.fantasy_team_id,new.athlete_id) then
    raise exception 'Varsity athletes and coaches cannot acquire athletes from their own program' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger participant_acquisition before insert or update of athlete_id,fantasy_team_id on public.roster_entries
for each row execute function beta_private.enforce_participant_acquisition();

create function beta_private.enforce_participant_pending_move() returns trigger
language plpgsql security definer set search_path='' as $$
declare team uuid; athlete uuid; league uuid;
begin
  if tg_table_name='waiver_claims' then team:=new.fantasy_team_id; athlete:=new.athlete_in_id; league:=new.league_id;
  else team:=new.to_team_id; athlete:=new.athlete_id; select league_id into league from public.fantasy_teams where id=team; end if;
  perform beta_private.league_lock(league);
  if not beta_private.can_acquire_athlete(team,athlete) then raise exception 'Varsity athletes and coaches cannot acquire athletes from their own program' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger participant_waiver before insert on public.waiver_claims for each row execute function beta_private.enforce_participant_pending_move();
create trigger participant_trade before insert on public.trade_items for each row execute function beta_private.enforce_participant_pending_move();
revoke all on function beta_private.enforce_participant_pending_move() from public,anon,authenticated,service_role;

create function rpc_private.get_my_participation() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  return (select jsonb_build_object('role',a.role,'programs',a.programs,'revision',a.revision,'displayName',p.display_name)
    from beta_private.account_participation a join public.profiles p on p.id=a.user_id where a.user_id=auth.uid());
end;
$$;
create function public.get_my_participation() returns jsonb language sql stable security invoker set search_path='' as $$ select rpc_private.get_my_participation(); $$;

create function rpc_private.admin_find_participants(p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.current_user_is_admin() then raise exception 'Administrator MFA required' using errcode='42501'; end if;
  if p_query is null or char_length(btrim(p_query)) not between 2 and 320 then raise exception 'Enter at least two characters'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
    select p.id,p.display_name,u.email,a.role,a.programs,a.revision
    from public.profiles p join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id
    where p.deleted_at is null and (position(lower(btrim(p_query)) in lower(p.display_name))>0 or position(lower(btrim(p_query)) in lower(u.email))>0)
    order by p.display_name,p.id limit 25
  ) r);
end;
$$;
create function public.admin_find_participants(p_query text) returns jsonb language sql stable security invoker set search_path='' as $$ select rpc_private.admin_find_participants(p_query); $$;

create function rpc_private.admin_set_participation(p_user_id uuid,p_role text,p_programs text[],p_expected_revision bigint,p_reason text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous beta_private.account_participation%rowtype; result jsonb; league uuid;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator MFA required' using errcode='42501'; end if;
  result:=beta_private.begin_command('admin_set_participation',p_idempotency_key); if result is not null then return result; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then raise exception 'Enter an audit reason of 8 to 500 characters'; end if;
  select * into previous from beta_private.account_participation where user_id=p_user_id for update;
  if previous.user_id is null then raise exception 'Account not found'; end if;
  if p_expected_revision is null or previous.revision<>p_expected_revision then raise exception 'Participation changed; reload and retry' using errcode='40001'; end if;
  for league in select league_id from public.league_members where user_id=p_user_id order by league_id loop perform beta_private.league_lock(league); end loop;
  if p_role is null or p_programs is null or cardinality(p_programs)<>(select count(distinct p) from unnest(p_programs) p) then raise exception 'Invalid participation'; end if;
  update beta_private.account_participation set role=p_role,programs=p_programs,revision=revision+1,updated_at=clock_timestamp() where user_id=p_user_id;
  perform beta_private.audit('account.participation_updated','profile',p_user_id::text,to_jsonb(previous),jsonb_build_object('role',p_role,'programs',p_programs,'reason',btrim(p_reason)),p_idempotency_key);
  return beta_private.finish_command('admin_set_participation',p_idempotency_key,jsonb_build_object('revision',previous.revision+1));
end;
$$;
create function public.admin_set_participation(p_user_id uuid,p_role text,p_programs text[],p_expected_revision bigint,p_reason text,p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$ select rpc_private.admin_set_participation(p_user_id,p_role,p_programs,p_expected_revision,p_reason,p_idempotency_key); $$;

revoke all on function beta_private.adopt_varsity_format(uuid),beta_private.participation_changed(),beta_private.member_varsity_format(),beta_private.record_signup_participation(),beta_private.can_acquire_athlete(uuid,uuid),beta_private.enforce_participant_acquisition() from public,anon,authenticated,service_role;
revoke all on function rpc_private.get_my_participation(),public.get_my_participation(),rpc_private.admin_find_participants(text),public.admin_find_participants(text),rpc_private.admin_set_participation(uuid,text,text[],bigint,text,text),public.admin_set_participation(uuid,text,text[],bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_my_participation(),public.get_my_participation(),rpc_private.admin_find_participants(text),public.admin_find_participants(text),rpc_private.admin_set_participation(uuid,text,text[],bigint,text,text),public.admin_set_participation(uuid,text,text[],bigint,text,text) to authenticated;

create or replace function beta_private.complete_draft_graph(candidates jsonb, slots jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  nc integer:=jsonb_array_length(candidates); ns integer:=jsonb_array_length(slots);
  eligible boolean[][]; slot_owner integer[]; athlete_slot integer[];
  parents integer[]; seen boolean[]; queue integer[]; head integer; tail integer;
  root integer; cur integer; target integer; old_slot integer; matched integer:=0;
  result jsonb:='{}';
begin
  if nc<ns or ns=0 then return null; end if;
  select jsonb_agg(c order by (c->>'owner' is null),c->>'id') into candidates
    from jsonb_array_elements(candidates)c;
  -- - Build the adjacency matrix in one SQL execution for each fallback candidate
  -- - Avoid a separate database query for every athlete and slot pair
  select array_agg(edges order by ordinal) into eligible from (
    select c.ordinal,array_agg(
      (c.value->>'owner' is null or c.value->>'owner'=s.value->>'team')
      and not coalesce(c.value->'blockedTeams','[]'::jsonb) ? (s.value->>'team')
      and s.value->'positions' ?| array(select jsonb_array_elements_text(c.value->'positions'))
      order by s.ordinal) edges
    from jsonb_array_elements(candidates) with ordinality c(value,ordinal)
    cross join jsonb_array_elements(slots) with ordinality s(value,ordinal)
    group by c.ordinal
  ) matrix;
  slot_owner:=array_fill(0,array[ns]); athlete_slot:=array_fill(0,array[nc]);
  for root in 1..nc loop
    if matched=ns and candidates->(root-1)->>'owner' is null then exit; end if;
    parents:=array_fill(0,array[ns]); seen:=array_fill(false,array[nc]);
    queue:=array_fill(0,array[nc]); queue[1]:=root; head:=1; tail:=1; seen[root]:=true; target:=0;
    while head<=tail and target=0 loop
      cur:=queue[head]; head:=head+1;
      for j in 1..ns loop
        if parents[j]<>0 or not eligible[cur][j] then continue; end if;
        parents[j]:=cur;
        if slot_owner[j]=0 then target:=j; exit; end if;
        if not seen[slot_owner[j]] then
          tail:=tail+1; queue[tail]:=slot_owner[j]; seen[slot_owner[j]]:=true;
        end if;
      end loop;
    end loop;
    if target=0 then
      if candidates->(root-1)->>'owner' is not null then return null; end if;
      continue;
    end if;
    matched:=matched+1;
    while target<>0 loop
      cur:=parents[target]; old_slot:=athlete_slot[cur];
      athlete_slot[cur]:=target; slot_owner[target]:=cur; target:=old_slot;
    end loop;
  end loop;
  if matched<>ns then return null; end if;
  for i in 1..nc loop
    if athlete_slot[i]<>0 then result:=result||jsonb_build_object(candidates->(i-1)->>'id',athlete_slot[i]-1); end if;
  end loop;
  return jsonb_build_object('owners',result,'slots',slots);
end;
$$;

create or replace function beta_private.draft_completion(league uuid, chosen uuid default null, chosen_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare candidates jsonb; slots jsonb;
begin
  select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,
    'blockedTeams',case when r.fantasy_team_id is not null then '[]'::jsonb else coalesce((select jsonb_agg(ft.id) from public.fantasy_teams ft where ft.league_id=l.id and not beta_private.can_acquire_athlete(ft.id,a.athlete_id)),'[]'::jsonb) end,
    'owner',case when a.athlete_id=chosen then chosen_team else r.fantasy_team_id end)
    order by (case when a.athlete_id=chosen then chosen_team else r.fantasy_team_id end is null),a.athlete_id)
  into candidates from public.leagues l join public.player_pools p on p.id=l.pool_id
  join public.pool_competitions pc on pc.pool_id=p.id
  join public.athlete_seasons a on a.competition_id=pc.competition_id and a.season_id=p.season_id and a.draft_eligible
  join public.athletes athlete on athlete.id=a.athlete_id and athlete.status='active' and athlete.fantasy_withdrawn_at is null
  left join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.released_at is null
  where l.id=league;
  select jsonb_agg(jsonb_build_object('team',t.id,'code',sr.slot_code,'positions',sr.allowed_positions)
    order by sr.is_starter desc,t.id,sr.slot_code,n)
  into slots from public.fantasy_teams t join public.leagues l on l.id=t.league_id
  join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id
  cross join lateral generate_series(1,sr.slot_count) n where l.id=league;
  if candidates is null or slots is null or (chosen is not null and not exists(
    select 1 from jsonb_array_elements(candidates)c where c->>'id'=chosen::text
  )) then return null; end if;
  return beta_private.complete_draft_graph(candidates,slots);
end;
$$;

create or replace function rpc_private.get_draft_room_snapshot(
  p_draft_id uuid,p_known_revision text default null,p_known_pool_revision text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  d public.drafts%rowtype; l public.leagues%rowtype; p public.player_pools%rowtype;
  adps jsonb; my_team uuid; q jsonb; roster jsonb; revision text; pool_revision text; result jsonb;
begin
  perform rpc_private.require_app_access();
  select * into d from public.drafts where id=p_draft_id;
  if d.id is null or not public.is_league_member(d.league_id) then
    raise exception 'Draft membership required' using errcode='42501';
  end if;
  select * into l from public.leagues where id=d.league_id;
  select * into p from public.player_pools where id=l.pool_id;
  if p.id is null then raise exception 'This draft requires a combined sport player pool'; end if;
  if d.status = 'complete' then
    return jsonb_build_object('closed',true,'unchanged',false,
      'revision',d.state_version::text,'poolRevision',p.state_version::text,'serverTime',clock_timestamp(),
      'draft',jsonb_build_object('id',d.id,'league_id',l.id,'status',d.status,'rounds',d.rounds,
        'current_overall_pick',d.current_overall_pick,'state_version',d.state_version,'team_order','[]'::jsonb),
      'league',jsonb_build_object('id',l.id,'name',l.name,'pool_id',l.pool_id,'roster_format',l.roster_format));
  end if;
  adps:=beta_private.pool_adp(p.id);
  select id into my_team from public.fantasy_teams where league_id=l.id and owner_id=auth.uid();
  select coalesce(jsonb_agg(athlete_id order by priority),'[]') into q from public.draft_queues
    where draft_id=d.id and fantasy_team_id=my_team;
  select coalesce(jsonb_agg(jsonb_build_object('fantasy_team_id',fantasy_team_id,'athlete_id',athlete_id,
    'slot_code',slot_code,'status',status) order by fantasy_team_id,athlete_id),'[]')
    into roster from public.roster_entries where league_id=l.id and released_at is null;
  pool_revision:=p.id::text||':'||p.state_version::text||':'||md5(adps::text);
  revision:=md5(d.state_version::text||':'||l.state_version::text||':'||pool_revision||':'||q::text||':'||roster::text);
  result:=jsonb_build_object('revision',revision,'poolRevision',pool_revision,'serverTime',clock_timestamp());
  if revision=p_known_revision and pool_revision=p_known_pool_revision then
    return result||jsonb_build_object('unchanged',true);
  end if;
  result:=result||jsonb_build_object(
    'unchanged',false,'draft',to_jsonb(d)-'rankings_snapshot',
    'league',jsonb_build_object('id',l.id,'name',l.name,'pool_id',l.pool_id,'roster_format',l.roster_format),
    'myTeamId',my_team,'queue',q,'roster',roster,
    'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'league_id',league_id,
      'owner_id',owner_id,'name',name,'draft_position',draft_position) order by draft_position),'[]')
      from public.fantasy_teams where league_id=l.id),
    'picks',(select coalesce(jsonb_agg(to_jsonb(dp) order by overall_pick),'[]') from public.draft_picks dp where draft_id=d.id),
    'slots',(select jsonb_agg(jsonb_build_object('teamId',t.id,'code',sr.slot_code,
      'label',sr.label,'positions',sr.allowed_positions) order by sr.is_starter desc,t.id,sr.slot_code,n)
      from public.fantasy_teams t join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id
      cross join lateral generate_series(1,sr.slot_count)n where t.league_id=l.id),
    'candidates',(select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,'ownerId',r.fantasy_team_id,'blockedTeamIds',case when r.fantasy_team_id is not null then '[]'::jsonb else coalesce((select jsonb_agg(ft.id) from public.fantasy_teams ft where ft.league_id=l.id and not beta_private.can_acquire_athlete(ft.id,a.athlete_id)),'[]'::jsonb) end)
      order by (r.fantasy_team_id is null),a.athlete_id)
      from public.pool_competitions pc join public.athlete_seasons a on a.competition_id=pc.competition_id
      join public.athletes athlete on athlete.id=a.athlete_id and athlete.status='active'
      left join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.released_at is null
      where pc.pool_id=p.id and a.season_id=p.season_id and a.draft_eligible)
  );
  if pool_revision is distinct from p_known_pool_revision then
    result:=result||jsonb_build_object('players',(
      select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'competition_id',a.competition_id,'team_id',a.team_id,
        'display_name',a.display_name,'position',a.position,'jersey_number',a.jersey_number,'status',a.status,'bio',a.bio,
        'positions',m.positions,'program',c.name,'rank',pr.rank,'adp',adps->a.id::text,
        'summaries',(select coalesce(jsonb_agg(to_jsonb(s)-'athlete_id'-'import_id'),'[]')
          from public.athlete_season_summaries s where s.athlete_id=a.id)) order by pr.rank),'[]')
      from public.pool_rankings pr join public.athletes a on a.id=pr.athlete_id and a.status='active'
      join public.athlete_seasons m on m.athlete_id=a.id and m.season_id=p.season_id and m.draft_eligible
      join public.competitions c on c.id=m.competition_id where pr.pool_id=p.id
    ));
  end if;
  return result;
end;
$$;

create or replace function rpc_private.set_period_lineup(p_fantasy_team_id uuid,p_entries jsonb,p_expected_version bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; existing jsonb; begin
  perform rpc_private.require_app_access();
  existing:=beta_private.begin_command('set_period_lineup',p_idempotency_key); if existing is not null then return existing; end if;
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=p_fantasy_team_id;
  perform beta_private.league_lock(l.id);select * into l from public.leagues where id=l.id for update;
  if l.pool_id is null or l.status<>'active' then raise exception 'Active beta league required'; end if;
  if p_expected_version is null or l.state_version<>p_expected_version then raise exception 'Lineup changed; reload and retry' using errcode='40001'; end if;
  perform beta_private.snapshot_locks(l.id);
  if exists(select 1 from public.roster_entries r where r.fantasy_team_id=p_fantasy_team_id and r.released_at is null and not beta_private.can_acquire_athlete(p_fantasy_team_id,r.athlete_id)) then raise exception 'Replace athletes from your own varsity program before saving your next lineup'; end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<>10 or jsonb_array_length(p_entries)<>(select count(*) from public.roster_entries where fantasy_team_id=p_fantasy_team_id and released_at is null)
    or jsonb_array_length(p_entries)<>(select count(distinct e->>'athlete_id') from jsonb_array_elements(p_entries)e) then raise exception 'Include each rostered athlete exactly once'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries)e(athlete_id uuid,slot_code text)
    left join public.roster_entries r on r.fantasy_team_id=p_fantasy_team_id and r.athlete_id=e.athlete_id and r.released_at is null
    left join public.player_pools p on p.id=l.pool_id left join public.athlete_seasons a on a.athlete_id=e.athlete_id and a.season_id=p.season_id
    left join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id and sr.slot_code=e.slot_code
    where r.id is null or sr.id is null or not a.positions && sr.allowed_positions or (e.slot_code<>'BN' and (not a.directory_visible or not a.draft_eligible)) or (r.slot_code<>e.slot_code and beta_private.is_locked(l.id,e.athlete_id))) then raise exception 'Invalid position or locked athlete'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries)e(athlete_id uuid,slot_code text) join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id and sr.slot_code=e.slot_code group by e.slot_code,sr.slot_count having count(*)>sr.slot_count) then raise exception 'Slot capacity exceeded'; end if;
  update public.roster_entries r set slot_code=e.slot_code,status=case when e.slot_code='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end
  from jsonb_to_recordset(p_entries)e(athlete_id uuid,slot_code text) where r.fantasy_team_id=p_fantasy_team_id and r.athlete_id=e.athlete_id and r.released_at is null;
  update public.leagues set state_version=state_version+1 where id=l.id;
  perform beta_private.audit('lineup.updated','fantasy_team',p_fantasy_team_id::text,null,p_entries,p_idempotency_key);
  return beta_private.finish_command('set_period_lineup',p_idempotency_key,jsonb_build_object('state_version',l.state_version+1));
end $$;

create or replace function rpc_private.get_beta_lineup(p_fantasy_team_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype;fp public.fantasy_periods%rowtype;
begin
  perform rpc_private.require_app_access();
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=p_fantasy_team_id;
  select f.* into fp from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
    where p.id=l.pool_id and f.ends_at>clock_timestamp() order by f.starts_at limit 1;
  return jsonb_build_object('period',to_jsonb(fp),'state_version',l.state_version,'entries',coalesce((
    select jsonb_agg(jsonb_build_object('athlete_id',r.athlete_id,'display_name',case when a.fantasy_withdrawn_at is null then a.display_name else 'Unavailable athlete' end,
      'participation_conflict',not beta_private.can_acquire_athlete(p_fantasy_team_id,a.id),'positions',s.positions,'slot_code',r.slot_code,'status',r.status,'locked',beta_private.is_locked(l.id,a.id),
      'locks_at',(select min(g.lineup_lock_at) from public.games g where g.competition_id=s.competition_id
        and s.team_id in (g.home_team_id,g.away_team_id) and g.status in ('scheduled','in_progress')
        and (g.starts_at>=clock_timestamp() or g.status='in_progress' or g.lineup_lock_at<=clock_timestamp())),'unlocks_at',null))
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id
    join public.player_pools p on p.id=l.pool_id join public.athlete_seasons s on s.athlete_id=a.id and s.season_id=p.season_id
    where r.fantasy_team_id=p_fantasy_team_id and r.released_at is null),'[]'));
end;
$$;

create or replace function beta_private.snapshot_locks(league uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform beta_private.league_lock(league);
  insert into public.game_lineup_snapshots
  select l.id,r.fantasy_team_id,g.id,r.athlete_id,r.id,fp.id,h.slot_code,h.status,g.lineup_lock_at
  from public.leagues l join public.player_pools p on p.id=l.pool_id
  join public.fantasy_periods fp on fp.season_id=p.season_id
  join public.games g on g.starts_at>=fp.starts_at and g.starts_at<fp.ends_at
    and g.lineup_lock_at<=clock_timestamp() and g.status not in ('postponed','cancelled')
    and g.schedule_kind in ('regular','playoff')
  join public.athlete_seasons a on a.season_id=p.season_id and a.competition_id=g.competition_id
    and a.team_id in (g.home_team_id,g.away_team_id)
  join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id
    and r.acquired_at<=g.lineup_lock_at and (r.released_at is null or r.released_at>g.lineup_lock_at)
  cross join lateral (select sh.slot_code,sh.status from public.roster_slot_history sh
    where sh.roster_entry_id=r.id and sh.effective_at<=g.lineup_lock_at
    order by sh.effective_at desc,sh.id desc limit 1) h
  where l.id=league and beta_private.can_field_athlete(r.fantasy_team_id,r.athlete_id,g.lineup_lock_at) and not exists(select 1 from public.game_lineup_snapshots x where x.league_id=l.id and x.game_id=g.id and x.athlete_id=r.athlete_id)
  on conflict do nothing;
  insert into public.lineup_entries(league_id,fantasy_team_id,game_id,athlete_id,slot_code,locked_at)
  select x.league_id,x.fantasy_team_id,x.game_id,x.athlete_id,x.slot_code,x.locked_at
  from public.game_lineup_snapshots x where x.league_id=league and x.status='starter'
  on conflict do nothing;
end;
$$;

create or replace function rpc_private.generate_matchup_schedule(p_league_id uuid,p_starts_at timestamptz,p_cycles integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb;l public.leagues%rowtype;teams uuid[];fp public.fantasy_periods%rowtype;n integer;tail uuid;period_count integer:=0;begin
  perform rpc_private.require_app_access();
  select * into l from public.leagues where id=p_league_id;
  if l.pool_id is null then return public.legacy_generate_matchup_schedule(p_league_id,p_starts_at,p_cycles,p_idempotency_key);end if;
  existing:=beta_private.begin_command('generate_matchup_schedule',p_idempotency_key);if existing is not null then return existing;end if;
  perform beta_private.league_lock(l.id);
  if not public.is_league_commissioner(l.id) or l.status not in ('drafting','active') then raise exception 'Commissioner of a started league required';end if;
  if exists(select 1 from public.matchups where league_id=l.id) then raise exception 'Schedule already generated';end if;
  select array_agg(id order by preseason_order) into teams from public.fantasy_teams where league_id=l.id;n:=cardinality(teams);
  if n=8 and p_cycles is distinct from 1 then raise exception 'Eight-manager leagues use one round-robin cycle'; end if;
  for fp in select f.* from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id where p.id=l.pool_id and f.phase='regular' order by number limit case when n=8 then 7 else 8 end loop
    period_count:=period_count+1;
    for i in 1..n/2 loop
      insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id)
      values(l.id,fp.number,fp.starts_at,fp.ends_at,case when fp.number%2=1 then teams[i] else teams[n-i+1] end,case when fp.number%2=1 then teams[n-i+1] else teams[i] end);
    end loop;
    tail:=teams[n];teams:=array[teams[1],tail]||teams[2:n-1];
  end loop;
  update public.leagues set state_version=state_version+1 where id=l.id;
  return beta_private.finish_command('generate_matchup_schedule',p_idempotency_key,jsonb_build_object('periods',period_count,'matchups_created',n*period_count/2));
end $$;
notify pgrst,'reload schema';

-- - Remove only future unplayed extra pairings from the old eight-team generator
create function beta_private.repair_eight_team_schedule(league uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  perform beta_private.league_lock(league);
  with deleted as (
    delete from public.matchups m using public.leagues l,public.player_pools p,public.fantasy_periods f
    where m.league_id=league and l.id=m.league_id and l.max_members=8 and p.id=l.pool_id
      and f.season_id=p.season_id and f.number=m.period and f.phase='regular' and m.period>7
      and m.status='scheduled' and m.starts_at>clock_timestamp() and m.home_points=0 and m.away_points=0
      and exists(select 1 from public.matchups prior where prior.league_id=m.league_id and prior.period<m.period
        and least(prior.home_team_id,prior.away_team_id)=least(m.home_team_id,m.away_team_id)
        and greatest(prior.home_team_id,prior.away_team_id)=greatest(m.home_team_id,m.away_team_id))
    returning m.id
  ) select count(*)::integer into removed from deleted;
  if removed>0 then
    update public.leagues set state_version=state_version+1 where id=league;
    perform beta_private.audit('schedule.extra_round_removed','league',league::text,null,jsonb_build_object('removed',removed));
  end if;
  return removed;
end;
$$;
revoke all on function beta_private.repair_eight_team_schedule(uuid) from public,anon,authenticated,service_role;
select beta_private.repair_eight_team_schedule(id) from public.leagues where pool_id is not null and max_members=8;

create or replace function rpc_private.get_player_insights(p_pool_id uuid,p_athlete_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform rpc_private.require_app_access();
  with totals as (
    select n.athlete_id,sum(n.fantasy_points) points from public.normalized_player_game_stats n
    join public.games g on g.id=n.game_id join public.pool_competitions pc on pc.competition_id=g.competition_id and pc.pool_id=p_pool_id
    where n.complete group by n.athlete_id
  ), stat_totals as (
    select n.athlete_id,kv.key,sum((kv.value #>> '{}')::numeric) value
    from public.normalized_player_game_stats n
    join public.games g on g.id=n.game_id
    join public.pool_competitions pc on pc.competition_id=g.competition_id and pc.pool_id=p_pool_id
    cross join lateral jsonb_each(n.stats) kv
    where n.complete and g.schedule_kind in ('regular','playoff') and jsonb_typeof(kv.value)='number'
    group by n.athlete_id,kv.key
  ), stat_catalog as (
    select athlete_id,jsonb_object_agg(key,value) stats from stat_totals group by athlete_id
  ), adp as (select beta_private.pool_adp(p_pool_id) data)
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'displayName',a.display_name,'jerseyNumber',a.jersey_number,'bio',a.bio,'position',a.position,'positions',m.positions,
    'program',c.name,'programCode',c.division::text||'_'||sport.code::text,'team',team.name,'teamId',team.id,'competitionId',c.id,'seasonPoints',coalesce(t.points,0),
    'seasonStats',coalesce(sc.stats,'{}'::jsonb),'seasonProjection',q.season_points,'nextProjection',q.points,'projectedGames',q.projected_games,'scheduledGames',q.scheduled_games,
    'period',case when q.period_id is null then null else jsonb_build_object('number',q.period_number,'startsAt',q.starts_at,'endsAt',q.ends_at) end,
    'pending',q.pending,'adp',(adp.data->a.id::text->>'average')::numeric,
    'nextGame',(select jsonb_build_object('id',g.id,'starts_at',g.starts_at,'status',g.status,'schedule_confirmed',g.schedule_confirmed,
      'opponent',case when g.home_team_id=m.team_id then away.name else home.name end,'home',g.home_team_id=m.team_id,'neutral',g.neutral_site)
      from public.games g join public.teams home on home.id=g.home_team_id join public.teams away on away.id=g.away_team_id
      where g.competition_id=m.competition_id and m.team_id in (g.home_team_id,g.away_team_id) and g.starts_at>clock_timestamp()
        and g.status='scheduled' and g.schedule_kind in ('regular','playoff') order by g.starts_at,g.id limit 1)
  ) order by a.display_name),'[]') into result
  from public.player_pools p join public.fantasy_seasons fs on fs.id=p.season_id
  join public.pool_competitions pc on pc.pool_id=p.id
  join public.athlete_seasons m on m.competition_id=pc.competition_id and m.season_id=p.season_id
  join public.athletes a on a.id=m.athlete_id join public.competitions c on c.id=m.competition_id join public.teams team on team.id=m.team_id
  join public.sports sport on sport.id=c.sport_id
  left join beta_private.next_period_projections(p_pool_id) q on q.athlete_id=a.id
  left join stat_catalog sc on sc.athlete_id=a.id
  left join totals t on t.athlete_id=a.id cross join adp
  where p.id=p_pool_id and p.is_active and m.directory_visible and a.status='active' and a.fantasy_withdrawn_at is null
    and (p_athlete_id is null or a.id=p_athlete_id);
  return result;
end;
$$;
notify pgrst,'reload schema';
