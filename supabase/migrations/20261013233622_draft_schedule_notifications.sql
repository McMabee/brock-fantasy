alter table public.leagues add column draft_scheduled_for timestamptz;
alter table public.leagues add column draft_schedule_version bigint not null default 0;
alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe_key on public.notifications(dedupe_key) where dedupe_key is not null;
create index leagues_draft_reminders on public.leagues(draft_scheduled_for) where status='setup' and draft_scheduled_for is not null;

create or replace function rpc_private.set_draft_queue(p_draft_id uuid,p_athlete_ids uuid[],p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drafts%rowtype; team uuid; existing jsonb; effective uuid[];
begin
  perform rpc_private.require_app_access();
  select * into d from public.drafts where id=p_draft_id;
  if not exists(select 1 from public.leagues where id=d.league_id and pool_id is not null) then
    return public.legacy_set_draft_queue(p_draft_id,p_athlete_ids,p_idempotency_key);
  end if;
  existing:=beta_private.begin_command('set_draft_queue',p_idempotency_key);
  if existing is not null then return existing; end if;
  perform beta_private.league_lock(d.league_id);
  select * into d from public.drafts where id=p_draft_id;
  select id into team from public.fantasy_teams where league_id=d.league_id and owner_id=auth.uid();
  if team is null or d.status not in ('scheduled','active','paused') then raise exception 'Active draft owner required'; end if;
  if p_athlete_ids is null or cardinality(p_athlete_ids)>500
    or cardinality(p_athlete_ids)<>(select count(distinct a) from unnest(p_athlete_ids)a) then raise exception 'Invalid queue'; end if;
  if exists(select 1 from unnest(p_athlete_ids)a where not exists(
    select 1 from jsonb_array_elements(d.rankings_snapshot)q where q->>'athlete_id'=a::text
  )) then raise exception 'Ineligible athlete in queue'; end if;
  select coalesce(array_agg(a order by n),'{}') into effective from unnest(p_athlete_ids) with ordinality q(a,n)
    where not exists(select 1 from public.draft_picks dp where dp.draft_id=d.id and dp.athlete_id=a);
  delete from public.draft_queues where draft_id=d.id and fantasy_team_id=team;
  insert into public.draft_queues(draft_id,fantasy_team_id,athlete_id,priority)
    select d.id,team,a,n from unnest(effective) with ordinality q(a,n);
  return beta_private.finish_command('set_draft_queue',p_idempotency_key,
    jsonb_build_object('queued',cardinality(effective),'queue',to_jsonb(effective)));
end;
$$;

create function rpc_private.schedule_league_draft(p_league_id uuid,p_scheduled_for timestamptz,p_expected_version bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; existing jsonb;
begin
  perform rpc_private.require_app_access();
  existing:=beta_private.begin_command('schedule_league_draft',p_idempotency_key);
  if existing is not null then return existing; end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id for update;
  if l.id is null or not public.is_league_commissioner(l.id) then raise exception 'Commissioner access required' using errcode='42501'; end if;
  if l.status<>'setup' or exists(select 1 from public.drafts where league_id=l.id) then
    raise exception 'Scheduling can only change before the draft starts' using errcode='22023';
  end if;
  if p_expected_version is null or p_expected_version<>l.state_version then raise exception 'League changed; refresh and retry' using errcode='40001'; end if;
  if p_scheduled_for is not null and (p_scheduled_for<=clock_timestamp()
    or p_scheduled_for>=(select min(fp.starts_at) from public.fantasy_periods fp join public.player_pools pool on pool.season_id=fp.season_id where pool.id=l.pool_id)) then
    raise exception 'Choose a future date before the season starts' using errcode='22023';
  end if;
  update public.leagues set draft_scheduled_for=p_scheduled_for,draft_schedule_version=draft_schedule_version+1,state_version=state_version+1
    where id=l.id returning * into l;
  update public.notifications set read_at=coalesce(read_at,clock_timestamp()),
    body='This reminder was superseded. Open your league for the current draft schedule.',
    data=data||'{"obsolete":true}'::jsonb
    where kind='draft_reminder' and data->>'league_id'=l.id::text and data->>'obsolete' is distinct from 'true';
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
    select m.user_id,'draft_schedule_changed',case when p_scheduled_for is null then 'Draft schedule cleared' else 'Draft schedule updated' end,
      'Your commissioner updated the planned draft time. The commissioner will start the draft manually.',
      jsonb_build_object('league_id',l.id,'scheduled_for',p_scheduled_for,'schedule_version',l.draft_schedule_version),
      'draft-schedule:'||l.id||':'||l.draft_schedule_version||':'||m.user_id
    from public.league_members m where m.league_id=l.id on conflict do nothing;
  perform beta_private.audit('draft.scheduled','league',l.id::text,null,
    jsonb_build_object('scheduled_for',p_scheduled_for,'schedule_version',l.draft_schedule_version),p_idempotency_key);
  return beta_private.finish_command('schedule_league_draft',p_idempotency_key,
    jsonb_build_object('league_id',l.id,'state_version',l.state_version,'scheduled_for',p_scheduled_for));
end;
$$;
create function public.schedule_league_draft(p_league_id uuid,p_scheduled_for timestamptz,p_expected_version bigint,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$
  select rpc_private.schedule_league_draft(p_league_id,p_scheduled_for,p_expected_version,p_idempotency_key);
$$;
revoke all on function rpc_private.schedule_league_draft(uuid,timestamptz,bigint,text),public.schedule_league_draft(uuid,timestamptz,bigint,text) from public,anon,authenticated,service_role;
grant execute on function rpc_private.schedule_league_draft(uuid,timestamptz,bigint,text),public.schedule_league_draft(uuid,timestamptz,bigint,text) to authenticated;

-- One notification per user/game/start time, including bench players but never queues.
create function rpc_private.process_in_app_reminders() returns jsonb
language plpgsql security definer set search_path='' as $$
declare game_count integer; draft_count integer;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'Worker access required' using errcode='42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('brock-reminder-worker',0)) then return '{"busy":true}'; end if;
  update public.notifications n set read_at=coalesce(n.read_at,clock_timestamp()),
    body='This reminder was superseded. Open your league for the current draft schedule.',
    data=n.data||'{"obsolete":true}'::jsonb
    from public.leagues l where n.kind='draft_reminder' and n.data->>'league_id'=l.id::text
      and n.data->>'obsolete' is distinct from 'true'
      and (l.status<>'setup' or n.data->>'scheduled_for' is distinct from to_jsonb(l.draft_scheduled_for)#>>'{}');
  update public.notifications n set read_at=coalesce(n.read_at,clock_timestamp()),
    body='This game reminder was superseded. Open your lineup for the current game schedule.',
    data=n.data||'{"obsolete":true}'::jsonb
    from public.games g where n.kind='game_reminder' and n.data->>'game_id'=g.id::text
      and n.data->>'obsolete' is distinct from 'true'
      and (g.status in('cancelled','postponed') or n.data->>'starts_at' is distinct from to_jsonb(g.starts_at)#>>'{}');
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
  select distinct on(t.owner_id,g.id) t.owner_id,'game_reminder','A rostered player plays soon',
    'A game involving your roster starts within an hour. Review your lineup before game time.',
    jsonb_build_object('game_id',g.id,'league_id',t.league_id,'starts_at',g.starts_at),
    'game:'||t.owner_id||':'||g.id||':'||g.starts_at
  from public.roster_entries r join public.fantasy_teams t on t.id=r.fantasy_team_id
  join public.athlete_seasons a on a.athlete_id=r.athlete_id
  join public.games g on g.competition_id=a.competition_id and (g.home_team_id=a.team_id or g.away_team_id=a.team_id)
  join public.profiles profile on profile.id=t.owner_id and profile.deleted_at is null
  where r.released_at is null and g.status='scheduled' and g.starts_at>clock_timestamp()
    and g.starts_at<=clock_timestamp()+interval '1 hour'
  order by t.owner_id,g.id,t.league_id
  on conflict do nothing;
  get diagnostics game_count=row_count;
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
  select m.user_id,'draft_reminder','Your draft is coming up',
    'Your league draft is scheduled soon. The commissioner starts it manually.',
    jsonb_build_object('league_id',l.id,'scheduled_for',l.draft_scheduled_for,'schedule_version',l.draft_schedule_version,'minutes',due.minutes),
    'draft:'||l.id||':'||l.draft_schedule_version||':'||m.user_id||':'||due.minutes
  from public.leagues l join public.league_members m on m.league_id=l.id
  join public.profiles profile on profile.id=m.user_id and profile.deleted_at is null
  cross join lateral (
    select minutes from (values(1440),(60),(15)) windows(minutes)
    where l.draft_scheduled_for<=clock_timestamp()+make_interval(mins=>minutes)
    order by minutes limit 1
  ) due
  where l.status='setup' and l.draft_scheduled_for>clock_timestamp()
  on conflict do nothing;
  get diagnostics draft_count=row_count;
  return jsonb_build_object('games',game_count,'drafts',draft_count);
end;
$$;
create function public.process_in_app_reminders() returns jsonb
language sql security invoker set search_path='' as $$ select rpc_private.process_in_app_reminders(); $$;
revoke all on function rpc_private.process_in_app_reminders(),public.process_in_app_reminders() from public,anon,authenticated,service_role;
grant execute on function rpc_private.process_in_app_reminders(),public.process_in_app_reminders() to service_role;
select cron.schedule('brock-in-app-reminders','* * * * *','select public.process_in_app_reminders();');

create function beta_private.notify_trade_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare event text;
begin
  if tg_op='UPDATE' and new.status=old.status and new.execution_status=old.execution_status then return new; end if;
  event:=case when new.execution_status in ('completed','vetoed','conflicted') then new.execution_status else new.status::text end;
  -- Combined-sport trades use their reviewed commands; legacy commands already emit their own proposal notification.
  if not exists(select 1 from public.leagues where id=new.league_id and pool_id is not null) then return new; end if;
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
    select owner_id,'trade_'||event,
      case when event='proposed' then 'New trade request' when event='completed' then 'Trade completed' else 'Trade '||event end,
      'Review the player exchange in your league transactions.',
      jsonb_build_object('trade_id',new.id,'league_id',new.league_id,'status',event),
      'trade:'||new.id||':'||event||':'||owner_id
    from public.fantasy_teams where id in(new.proposing_team_id,new.receiving_team_id) and owner_id is not null
    on conflict do nothing;
  return new;
end;
$$;
revoke all on function beta_private.notify_trade_change() from public,anon,authenticated,service_role;
create trigger trade_in_app_notifications after insert or update on public.trades
  for each row execute function beta_private.notify_trade_change();

notify pgrst,'reload schema';
