-- - Preserve existing point events while moving future lineup decisions to individual games
alter table public.games
  add column schedule_confirmed boolean not null default true,
  add column schedule_revision bigint not null default 1,
  add column schedule_override boolean not null default false,
  add column schedule_kind text not null default 'regular' check (schedule_kind in ('regular','playoff','exhibition')),
  add column neutral_site boolean not null default false,
  add column official_schedule_key text,
  add column schedule_change jsonb not null default '{}'::jsonb;
create unique index official_game_identity on public.games(competition_id,official_schedule_key) where official_schedule_key is not null;

create table public.game_lineup_snapshots (
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id),
  game_id uuid not null references public.games(id),
  athlete_id uuid not null references public.athletes(id),
  roster_entry_id uuid not null references public.roster_entries(id),
  period_id uuid not null references public.fantasy_periods(id),
  slot_code text not null,
  status public.roster_status not null,
  locked_at timestamptz not null,
  primary key (league_id,game_id,athlete_id)
);
create index game_lineup_game on public.game_lineup_snapshots(game_id);
create index game_lineup_team on public.game_lineup_snapshots(fantasy_team_id,game_id);
alter table public.game_lineup_snapshots enable row level security;
revoke all on public.game_lineup_snapshots from public,anon,authenticated;
grant select on public.game_lineup_snapshots to authenticated;
grant all on public.game_lineup_snapshots to service_role;
create policy game_lineup_members on public.game_lineup_snapshots for select to authenticated
  using ((select public.can_use_app()) and public.is_league_member(league_id));

create or replace function beta_private.game_lock_time() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' or old.lineup_lock_at is null or old.lineup_lock_at>clock_timestamp() then
    new.lineup_lock_at:=case when new.status in ('cancelled','postponed') then null else new.starts_at end;
  elsif (old.status in ('cancelled','postponed') or new.status in ('cancelled','postponed'))
    and old.status<>'final'
    and not exists(select 1 from public.normalized_player_game_stats where game_id=old.id)
    and not exists(select 1 from public.fantasy_point_events where game_id=old.id)
    and not exists(select 1 from public.game_lineup_snapshots where game_id=old.id) then
    -- - Guarded unplayed postponement cleanup allows a fresh replacement-game lock
    new.lineup_lock_at:=case when new.status in ('cancelled','postponed') then null else new.starts_at end;
  else
    new.lineup_lock_at:=old.lineup_lock_at;
  end if;
  return new;
end $$;

-- - Retain the actual historical assignments from the old period snapshots
insert into public.game_lineup_snapshots
select x.league_id,x.fantasy_team_id,g.id,x.athlete_id,x.roster_entry_id,x.period_id,x.slot_code,x.status,g.lineup_lock_at
from public.period_lineup_locks x join public.fantasy_periods fp on fp.id=x.period_id
join public.athlete_seasons a on a.athlete_id=x.athlete_id and a.season_id=fp.season_id
join public.games g on g.competition_id=a.competition_id and a.team_id in (g.home_team_id,g.away_team_id)
where g.starts_at>=fp.starts_at and g.starts_at<fp.ends_at and g.lineup_lock_at<=clock_timestamp()
  and g.status not in ('postponed','cancelled')
on conflict do nothing;
delete from public.lineup_entries e using public.games g,public.leagues l
where e.game_id=g.id and e.league_id=l.id and l.pool_id is not null and g.lineup_lock_at>clock_timestamp()
  and not exists(select 1 from public.fantasy_point_events f where f.game_id=g.id and f.fantasy_team_id=e.fantasy_team_id);

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
  where l.id=league and not exists(select 1 from public.game_lineup_snapshots x where x.league_id=l.id and x.game_id=g.id and x.athlete_id=r.athlete_id)
  on conflict do nothing;
  insert into public.lineup_entries(league_id,fantasy_team_id,game_id,athlete_id,slot_code,locked_at)
  select x.league_id,x.fantasy_team_id,x.game_id,x.athlete_id,x.slot_code,x.locked_at
  from public.game_lineup_snapshots x where x.league_id=league and x.status='starter'
  on conflict do nothing;
end;
$$;

create or replace function beta_private.is_locked(league uuid,athlete uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.leagues l join public.player_pools p on p.id=l.pool_id
  join public.athlete_seasons a on a.season_id=p.season_id and a.athlete_id=athlete
  join public.games g on g.competition_id=a.competition_id and a.team_id in (g.home_team_id,g.away_team_id)
  where l.id=league and g.lineup_lock_at<=clock_timestamp() and g.status in ('scheduled','in_progress')
    and g.schedule_kind in ('regular','playoff'));
$$;

create or replace function beta_private.waiver_after(league uuid,athlete uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
select coalesce(max(released_at)+interval '24 hours','-infinity'::timestamptz)
from public.roster_entries where league_id=league and athlete_id=athlete;
$$;

-- - Aggregate consistent supplied projections once per athlete and season
create function beta_private.next_period_projections(p_pool_id uuid)
returns table(athlete_id uuid,period_id uuid,period_number integer,starts_at timestamptz,ends_at timestamptz,
  season_points numeric,projected_games numeric,scheduled_games bigint,points numeric,pending boolean)
language sql stable security definer set search_path='' as $$
with pool as (select p.season_id,s.label from public.player_pools p join public.fantasy_seasons s on s.id=p.season_id where p.id=p_pool_id),
target as (
  select fp.* from public.fantasy_periods fp join pool p on p.season_id=fp.season_id
  where fp.starts_at>clock_timestamp() order by fp.starts_at limit 1
), supplied as (
  select s.athlete_id,
    case when count(*)=count(s.fantasy_points) and count(distinct s.fantasy_points)=1 then min(s.fantasy_points) end fp,
    case when count(*)=count(s.games_played) and count(distinct s.games_played)=1 then min(s.games_played) end gp
  from public.athlete_season_summaries s join pool p on p.label=s.season_label
  where s.kind='supplied_projection' group by s.athlete_id
), fixtures as (
  select a.athlete_id,count(g.id) n,coalesce(bool_or(not g.schedule_confirmed),false) pending,
    bool_or(exists(select 1 from public.games known where known.competition_id=a.competition_id and known.schedule_kind in ('regular','playoff'))) known_schedule
  from pool p join public.athlete_seasons a on a.season_id=p.season_id
  cross join target t left join public.games g on g.competition_id=a.competition_id
    and a.team_id in (g.home_team_id,g.away_team_id) and g.starts_at>=t.starts_at and g.starts_at<t.ends_at
    and g.status in ('scheduled','in_progress','final') and g.schedule_kind in ('regular','playoff')
  group by a.athlete_id
)
select a.athlete_id,t.id,t.number,t.starts_at,t.ends_at,s.fp,s.gp,coalesce(f.n,0),
  case when t.id is null or not coalesce(f.known_schedule,false) then null when f.n=0 then 0 when s.gp>0 and s.fp is not null then round(s.fp/s.gp*f.n,2) end,
  coalesce(f.pending,false)
from pool p join public.athlete_seasons a on a.season_id=p.season_id
left join target t on true left join supplied s on s.athlete_id=a.athlete_id left join fixtures f on f.athlete_id=a.athlete_id;
$$;
revoke all on function beta_private.next_period_projections(uuid) from public,anon,authenticated,service_role;

-- - Add FLEX to every existing combined ruleset without changing scoring coefficients
insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
select distinct ruleset_id,'FLEX','Any sport / position',array['F','D','G','BC','FC','HT','L','S'],1,true
from public.player_pools on conflict(ruleset_id,slot_code) do nothing;
update public.roster_slot_rules set slot_count=3 where slot_code='BN' and ruleset_id in (select ruleset_id from public.player_pools);
select beta_private.snapshot_locks(id) from public.leagues where pool_id is not null;
with ranked as (
  select r.id,row_number() over(partition by r.fantasy_team_id order by q.points desc nulls last,q.season_points desc nulls last,a.display_name,r.id) n
  from public.roster_entries r join public.leagues l on l.id=r.league_id and l.pool_id is not null
  join public.athletes a on a.id=r.athlete_id
  left join lateral beta_private.next_period_projections(l.pool_id) q on q.athlete_id=r.athlete_id
  where r.released_at is null and r.slot_code='BN' and a.fantasy_withdrawn_at is null and a.status='active'
    and not exists(select 1 from public.roster_entries e where e.fantasy_team_id=r.fantasy_team_id and e.released_at is null and e.slot_code='FLEX')
)
update public.roster_entries r set slot_code='FLEX',status='starter' from ranked x where r.id=x.id and x.n=1;
update public.leagues set state_version=state_version+1 where pool_id is not null;

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
      'positions',s.positions,'slot_code',r.slot_code,'status',r.status,'locked',beta_private.is_locked(l.id,a.id),
      'locks_at',(select min(g.lineup_lock_at) from public.games g where g.competition_id=s.competition_id
        and s.team_id in (g.home_team_id,g.away_team_id) and g.status in ('scheduled','in_progress')
        and (g.starts_at>=clock_timestamp() or g.status='in_progress' or g.lineup_lock_at<=clock_timestamp())),'unlocks_at',null))
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id
    join public.player_pools p on p.id=l.pool_id join public.athlete_seasons s on s.athlete_id=a.id and s.season_id=p.season_id
    where r.fantasy_team_id=p_fantasy_team_id and r.released_at is null),'[]'));
end;
$$;

-- - Use a single authorized catalog for panels, projections, filters and league rosters
create function rpc_private.get_player_insights(p_pool_id uuid,p_athlete_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform rpc_private.require_app_access();
  with totals as (
    select n.athlete_id,sum(n.fantasy_points) points from public.normalized_player_game_stats n
    join public.games g on g.id=n.game_id join public.pool_competitions pc on pc.competition_id=g.competition_id and pc.pool_id=p_pool_id
    where n.complete group by n.athlete_id
  ), adp as (select beta_private.pool_adp(p_pool_id) data)
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'displayName',a.display_name,'jerseyNumber',a.jersey_number,'bio',a.bio,'position',a.position,'positions',m.positions,
    'program',c.name,'team',team.name,'teamId',team.id,'competitionId',c.id,'seasonPoints',coalesce(t.points,0),
    'seasonProjection',q.season_points,'nextProjection',q.points,'projectedGames',q.projected_games,'scheduledGames',q.scheduled_games,
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
  left join beta_private.next_period_projections(p_pool_id) q on q.athlete_id=a.id
  left join totals t on t.athlete_id=a.id cross join adp
  where p.id=p_pool_id and p.is_active and m.directory_visible and a.status='active' and a.fantasy_withdrawn_at is null
    and (p_athlete_id is null or a.id=p_athlete_id);
  return result;
end;
$$;
create function public.get_player_insights(p_pool_id uuid,p_athlete_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select rpc_private.get_player_insights(p_pool_id,p_athlete_id); $$;
revoke all on function rpc_private.get_player_insights(uuid,uuid),public.get_player_insights(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_player_insights(uuid,uuid),public.get_player_insights(uuid,uuid) to authenticated;

notify pgrst,'reload schema';

create table public.official_schedule_sources (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null unique references public.competitions(id),
  team_id uuid not null references public.teams(id),
  program text not null unique,
  url text not null check(url ~ '^https://gobadgers[.]ca/sports/(mens|womens)-(ice-hockey|basketball|volleyball)/schedule/2026-27[?]grid=true$'),
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text
);
alter table public.official_schedule_sources enable row level security;
revoke all on public.official_schedule_sources from public,anon,authenticated;
grant all on public.official_schedule_sources to service_role;
insert into public.official_schedule_sources(competition_id,team_id,program,url)
select c.id,t.id,case c.division when 'mens' then 'mens_' else 'womens_' end||s.code::text,
  'https://gobadgers.ca/sports/'||case c.division when 'mens' then 'mens-' else 'womens-' end||
  case s.code when 'hockey' then 'ice-hockey' else s.code::text end||'/schedule/2026-27?grid=true'
from public.competitions c join public.sports s on s.id=c.sport_id join public.teams t on t.competition_id=c.id and t.is_brock
where c.season_label='2026-27' and exists(select 1 from public.pool_competitions pc where pc.competition_id=c.id)
on conflict(competition_id) do nothing;

create unique index missing_projection_alert on public.sync_errors(error_code,(context->>'athlete_id'),(context->>'pool_id'))
  where error_code='MISSING_PERIOD_PROJECTION' and resolved_at is null;
create function beta_private.refresh_projection_alerts() returns void language plpgsql security definer set search_path='' as $$
begin
  update public.sync_errors e set resolved_at=clock_timestamp() where e.error_code='MISSING_PERIOD_PROJECTION' and e.resolved_at is null
    and not exists(select 1 from beta_private.next_period_projections((e.context->>'pool_id')::uuid) q
      where q.athlete_id=(e.context->>'athlete_id')::uuid and q.period_id is not null and (q.season_points is null or q.projected_games is null or q.projected_games<=0 or q.points is null));
  insert into public.sync_errors(error_code,message,context)
  select 'MISSING_PERIOD_PROJECTION','Next-period forecast needs supplied season points, positive projected games and a known season schedule',
    jsonb_build_object('pool_id',p.id,'athlete_id',q.athlete_id,'period_id',q.period_id)
  from public.player_pools p cross join lateral beta_private.next_period_projections(p.id) q
  join public.athlete_seasons a on a.athlete_id=q.athlete_id and a.season_id=p.season_id
  join public.athletes athlete on athlete.id=a.athlete_id and athlete.status='active' and athlete.fantasy_withdrawn_at is null
  where p.is_active and a.directory_visible and q.period_id is not null and (q.season_points is null or q.projected_games is null or q.projected_games<=0 or q.points is null)
  on conflict do nothing;
end;
$$;
revoke all on function beta_private.refresh_projection_alerts() from public,anon,authenticated,service_role;

create unique index official_schedule_sync_alert on public.sync_errors(error_code,(context->>'source_id')) where error_code='OFFICIAL_SCHEDULE_SYNC' and resolved_at is null;
create function public.apply_official_schedule(p_source_id uuid,p_games jsonb,p_error text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare source public.official_schedule_sources%rowtype; item jsonb; old public.games%rowtype;
  opponent uuid; home uuid; away uuid; next_status public.game_status; target uuid; proposed jsonb; n integer:=0; started boolean;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Worker access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('brock-schedule-sync',0));
  select * into source from public.official_schedule_sources where id=p_source_id and enabled for update;
  if source.id is null then raise exception 'Approved schedule source required'; end if;
  if p_error is not null then
    update public.official_schedule_sources set last_error=left(p_error,1000) where id=source.id;
    insert into public.sync_errors(error_code,message,context) values('OFFICIAL_SCHEDULE_SYNC',left(p_error,1000),jsonb_build_object('source_id',source.id))
      on conflict(error_code,(context->>'source_id')) where error_code='OFFICIAL_SCHEDULE_SYNC' and resolved_at is null do update set message=excluded.message;
    return jsonb_build_object('changed',0,'failed',true);
  end if;
  if jsonb_typeof(p_games)<>'array' or jsonb_array_length(p_games)>250 then raise exception 'Bounded schedule array required'; end if;
  -- - Snapshot historical ownership before any game can change status or timing
  perform beta_private.snapshot_locks(l.id) from public.leagues l where l.pool_id is not null and exists(
    select 1 from public.pool_competitions pc where pc.pool_id=l.pool_id and pc.competition_id=source.competition_id) order by l.id;
  for item in select value from jsonb_array_elements(p_games) loop
    if coalesce(item->>'key','')='' or char_length(item->>'key')>200 or coalesce(item->>'opponent','')='' or char_length(item->>'opponent')>150
      or item->>'kind' not in ('regular','playoff') or item->>'status' not in ('scheduled','final','postponed','cancelled')
      or jsonb_typeof(item->'home')<>'boolean' or (item->>'startsAt')::timestamptz not between '2026-08-01'::timestamptz and '2027-06-01'::timestamptz then
      raise exception 'Invalid official fixture'; end if;
    select * into old from public.games where competition_id=source.competition_id and
      (official_schedule_key=item->>'key' or (id=nullif(item->>'id','')::uuid and official_schedule_key is null)) for update;
    if old.id is not null then
      update public.games set official_schedule_key=item->>'key' where id=old.id and official_schedule_key is null;
    end if;
    select id into opponent from public.teams where competition_id=source.competition_id and lower(name)=lower(item->>'opponent');
    if opponent is null then
      insert into public.teams(competition_id,name,short_name,is_brock) values(source.competition_id,item->>'opponent',left(item->>'opponent',16),false)
      on conflict(competition_id,name) do update set name=excluded.name returning id into opponent;
    end if;
    home:=case when (item->>'home')::boolean then source.team_id else opponent end;
    away:=case when (item->>'home')::boolean then opponent else source.team_id end;
    next_status:=(item->>'status')::public.game_status;
    proposed:=jsonb_build_object('starts_at',(item->>'startsAt')::timestamptz,'status',next_status,'home_team_id',home,'away_team_id',away,'schedule_kind',item->>'kind','neutral_site',coalesce((item->>'neutral')::boolean,false));
    if old.id is not null and not old.schedule_override
      and (old.status in ('postponed','cancelled') or next_status in ('postponed','cancelled'))
      and old.status<>'final' and not exists(select 1 from public.normalized_player_game_stats where game_id=old.id)
      and not exists(select 1 from public.fantasy_point_events where game_id=old.id) then
      -- - A postponed unplayed game must capture a fresh lineup at its replacement start
      delete from public.lineup_entries where game_id=old.id;
      delete from public.game_lineup_snapshots where game_id=old.id;
    end if;
    if old.id is null then
      insert into public.games(competition_id,home_team_id,away_team_id,starts_at,status,source_url,schedule_confirmed,schedule_kind,neutral_site,official_schedule_key,schedule_change)
      values(source.competition_id,home,away,(item->>'startsAt')::timestamptz,next_status,source.url,false,item->>'kind',coalesce((item->>'neutral')::boolean,false),item->>'key',jsonb_build_object('source',proposed)) returning id into target;
      n:=n+1;
    elsif old.schedule_override then
      if old.schedule_change->'source' is distinct from proposed then
        update public.games set schedule_change=jsonb_build_object('source',proposed,'before',to_jsonb(old)-'schedule_change','override_conflict',true),
          schedule_confirmed=false,schedule_revision=schedule_revision+1 where id=old.id;
        n:=n+1;
      end if;
    elsif (old.starts_at is distinct from (item->>'startsAt')::timestamptz or old.status is distinct from next_status
      or old.home_team_id<>home or old.away_team_id<>away or old.schedule_kind<>item->>'kind' or old.neutral_site<>coalesce((item->>'neutral')::boolean,false))
      and old.schedule_change->'source' is distinct from proposed then
      started:=old.status in ('in_progress','final')
        or exists(select 1 from public.game_lineup_snapshots where game_id=old.id)
        or exists(select 1 from public.normalized_player_game_stats where game_id=old.id)
        or exists(select 1 from public.fantasy_point_events where game_id=old.id);
      -- - Protect captured game identity and scoring history while applying completion status
      update public.games set
        starts_at=case when started then old.starts_at else (item->>'startsAt')::timestamptz end,
        home_team_id=case when started then old.home_team_id else home end,
        away_team_id=case when started then old.away_team_id else away end,
        status=case when old.status='final' or (old.status='in_progress' and next_status='scheduled') then old.status else next_status end,
        schedule_kind=case when started then old.schedule_kind else item->>'kind' end,
        neutral_site=coalesce((item->>'neutral')::boolean,false),
        schedule_confirmed=false,schedule_revision=schedule_revision+1,state_version=state_version+1,
        schedule_change=jsonb_build_object('before',to_jsonb(old)-'schedule_change','source',proposed,'history_protected',started),source_updated_at=clock_timestamp()
      where id=old.id;
      n:=n+1;
    end if;
  end loop;
  update public.official_schedule_sources set last_synced_at=clock_timestamp(),last_error=null where id=source.id;
  update public.sync_errors set resolved_at=clock_timestamp() where error_code='OFFICIAL_SCHEDULE_SYNC' and context->>'source_id'=source.id::text and resolved_at is null;
  perform beta_private.refresh_projection_alerts();
  perform beta_private.audit('schedule.synced','schedule_source',source.id::text,null,jsonb_build_object('changed',n));
  return jsonb_build_object('changed',n);
end;
$$;
revoke all on function public.apply_official_schedule(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.apply_official_schedule(uuid,jsonb,text) to service_role;

create function rpc_private.review_game_schedule(p_game_id uuid,p_expected_revision bigint,p_action text,p_changes jsonb,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.games%rowtype; existing jsonb; next_start timestamptz; next_status public.game_status;
  brock uuid; opponent uuid; opponent_name text; next_home uuid; next_away uuid; next_kind text; next_neutral boolean;
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() then raise exception 'Administrator AAL2 access required' using errcode='42501'; end if;
  existing:=beta_private.begin_command('review_game_schedule',p_idempotency_key); if existing is not null then return existing; end if;
  if p_action not in ('confirm','override','clear_override') or p_action is null or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then raise exception 'Action and detailed reason required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('brock-schedule-sync',0));
  select * into old from public.games where id=p_game_id;
  perform beta_private.snapshot_locks(l.id) from public.leagues l where l.pool_id is not null and exists(
    select 1 from public.pool_competitions pc where pc.pool_id=l.pool_id and pc.competition_id=old.competition_id) order by l.id;
  select * into old from public.games where id=p_game_id for update;
  if old.id is null or p_expected_revision is null or old.schedule_revision<>p_expected_revision then raise exception 'Schedule changed; reload and retry' using errcode='40001'; end if;
  if p_action='override' then
    if old.status='final' then raise exception 'Completed-game schedules are protected'; end if;
    if jsonb_typeof(p_changes)<>'object' or p_changes is null then raise exception 'Schedule fields required'; end if;
    next_start:=coalesce((p_changes->>'starts_at')::timestamptz,old.starts_at);
    next_status:=coalesce((p_changes->>'status')::public.game_status,old.status);
    if next_status not in ('scheduled','postponed','cancelled') then raise exception 'Use scorekeeping to finish a game'; end if;
    if old.status='in_progress' and next_status='scheduled' then raise exception 'Postpone an unplayed game before rescheduling it'; end if;
    next_home:=old.home_team_id; next_away:=old.away_team_id;
    next_kind:=coalesce(p_changes->>'schedule_kind',old.schedule_kind);
    next_neutral:=coalesce((p_changes->>'neutral_site')::boolean,old.neutral_site);
    if next_kind not in ('regular','playoff','exhibition') then raise exception 'Invalid game phase'; end if;
    if p_changes ? 'opponent' or p_changes ? 'home' then
      select team_id into brock from public.official_schedule_sources where competition_id=old.competition_id;
      if brock is null then raise exception 'Approved program mapping required'; end if;
      select name into opponent_name from public.teams where id=case when old.home_team_id=brock then old.away_team_id else old.home_team_id end;
      opponent_name:=btrim(coalesce(p_changes->>'opponent',opponent_name));
      if char_length(opponent_name) not between 2 and 150 then raise exception 'Valid opponent name required'; end if;
      insert into public.teams(competition_id,name,short_name,is_brock) values(old.competition_id,opponent_name,left(opponent_name,16),false)
      on conflict(competition_id,name) do update set name=excluded.name returning id into opponent;
      if opponent=brock then raise exception 'Opponent must differ from Brock'; end if;
      next_home:=case when coalesce((p_changes->>'home')::boolean,old.home_team_id=brock) then brock else opponent end;
      next_away:=case when next_home=brock then opponent else brock end;
    end if;
    if (old.status in ('postponed','cancelled') or next_status in ('postponed','cancelled')) and old.status<>'final'
      and not exists(select 1 from public.normalized_player_game_stats where game_id=old.id)
      and not exists(select 1 from public.fantasy_point_events where game_id=old.id) then
      delete from public.lineup_entries where game_id=old.id;
      delete from public.game_lineup_snapshots where game_id=old.id;
    end if;
    if (next_start<>old.starts_at or next_home<>old.home_team_id or next_away<>old.away_team_id or next_kind<>old.schedule_kind)
      and (old.status='in_progress' or exists(select 1 from public.game_lineup_snapshots where game_id=old.id)
        or exists(select 1 from public.normalized_player_game_stats where game_id=old.id)
        or exists(select 1 from public.fantasy_point_events where game_id=old.id)) then raise exception 'Started-game timing and opponents are protected'; end if;
    update public.games set starts_at=next_start,status=next_status,home_team_id=next_home,away_team_id=next_away,
      schedule_kind=next_kind,neutral_site=next_neutral,schedule_override=true,state_version=state_version+1 where id=old.id;
  elsif p_action='clear_override' then
    update public.games set schedule_override=false,schedule_change='{}'::jsonb where id=old.id;
  end if;
  update public.games set schedule_confirmed=true,schedule_revision=schedule_revision+1 where id=old.id;
  perform beta_private.audit('schedule.'||p_action,'game',old.id::text,to_jsonb(old),
    jsonb_build_object('game',(select to_jsonb(g) from public.games g where g.id=old.id),'reason',btrim(p_reason)),p_idempotency_key);
  perform beta_private.refresh_projection_alerts();
  return beta_private.finish_command('review_game_schedule',p_idempotency_key,jsonb_build_object('game_id',old.id,'revision',old.schedule_revision+1));
end;
$$;
create function public.review_game_schedule(p_game_id uuid,p_expected_revision bigint,p_action text,p_changes jsonb,p_reason text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.review_game_schedule(p_game_id,p_expected_revision,p_action,p_changes,p_reason,p_idempotency_key); $$;

create function rpc_private.get_schedule_review() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() then raise exception 'Administrator AAL2 access required' using errcode='42501'; end if;
  perform beta_private.refresh_projection_alerts();
  return jsonb_build_object('games',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from (
    select g.*,c.name program,h.name home,a.name away,h.is_brock home_is_brock from public.games g join public.competitions c on c.id=g.competition_id
    join public.teams h on h.id=g.home_team_id join public.teams a on a.id=g.away_team_id
    where c.season_label='2026-27' order by g.schedule_confirmed,g.starts_at limit 500) x),'[]'),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.program) from public.official_schedule_sources s),'[]'),
    'alerts',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.id,e.message,e.context,a.display_name from public.sync_errors e
      left join public.athletes a on a.id=nullif(e.context->>'athlete_id','')::uuid where e.resolved_at is null and e.error_code in ('MISSING_PERIOD_PROJECTION','OFFICIAL_SCHEDULE_SYNC') order by e.created_at desc limit 500) x),'[]'));
end;
$$;
create function public.get_schedule_review() returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.get_schedule_review(); $$;
revoke all on function rpc_private.review_game_schedule(uuid,bigint,text,jsonb,text,text),public.review_game_schedule(uuid,bigint,text,jsonb,text,text),rpc_private.get_schedule_review(),public.get_schedule_review() from public,anon,authenticated,service_role;
grant execute on function rpc_private.review_game_schedule(uuid,bigint,text,jsonb,text,text),public.review_game_schedule(uuid,bigint,text,jsonb,text,text),rpc_private.get_schedule_review(),public.get_schedule_review() to authenticated;

create or replace function beta_private.replay_beta_game(p_game_id uuid, p_source_identity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row record;
  score_row record;
  event_row record;
  current_points numeric;
  inserted_count integer := 0;
  incomplete boolean := false;
  missing text[];
begin
  select g.id, g.competition_id, s.code as sport
  into game_row
  from public.games g
  join public.competitions c on c.id = g.competition_id
  join public.sports s on s.id = c.sport_id
  where g.id = p_game_id
;
  if game_row.id is null then raise exception 'Game not found'; end if;

  perform beta_private.snapshot_locks(l.id)
  from public.leagues l where l.pool_id is not null and exists (
    select 1 from public.player_pools p join public.pool_competitions pc on pc.pool_id = p.id
    where p.id = l.pool_id and pc.competition_id = game_row.competition_id
  );

  perform 1 from public.games where id=p_game_id for update;

  -- - Publish canonical athlete totals once independently of fantasy-team ownership
  with calculated as (
    select n.athlete_id,score.total,score.complete,score.missing
    from public.normalized_player_game_stats n
    join public.athlete_seasons a on a.athlete_id=n.athlete_id and a.competition_id=game_row.competition_id
    join lateral (select p.ruleset_id from public.player_pools p where p.season_id=a.season_id and p.is_active order by p.id limit 1) rules on true
    cross join lateral (select sum(x.points) total,bool_and(x.complete) complete,
      array_agg(replace(x.stat_key,'__missing__:','')) filter(where not x.complete) missing
      from beta_private.score_beta_stat_line(rules.ruleset_id,game_row.sport,a.positions,n.stats) x) score
    where n.game_id=p_game_id
  )
  update public.normalized_player_game_stats n set fantasy_points=case when c.complete then c.total end,
    complete=coalesce(c.complete,false),missing_stats=coalesce(c.missing,'{}')
  from calculated c where n.game_id=p_game_id and n.athlete_id=c.athlete_id;

  for score_row in
    select pll.league_id, pll.fantasy_team_id, pll.athlete_id, l.ruleset_id, membership.positions, stats.stats
    from public.game_lineup_snapshots pll
    join public.leagues l on l.id = pll.league_id and l.pool_id is not null
    join public.player_pools pool on pool.id = l.pool_id
    join public.fantasy_periods period on period.id = pll.period_id
    join public.athlete_seasons membership on membership.athlete_id = pll.athlete_id and membership.season_id = pool.season_id and membership.competition_id = game_row.competition_id
    join public.normalized_player_game_stats stats on stats.game_id = p_game_id and stats.athlete_id = pll.athlete_id
    join public.games game on game.id = p_game_id and pll.game_id = game.id and game.status not in ('cancelled','postponed')
    where pll.status = 'starter'
  loop
    select array_agg(replace(stat_key, '__missing__:', '') order by stat_key)
    into missing
    from beta_private.score_beta_stat_line(score_row.ruleset_id, game_row.sport, score_row.positions, score_row.stats)
    where not complete;
    if missing is not null then
      incomplete := true;
      update public.normalized_player_game_stats set complete = false, missing_stats = string_to_array(array_to_string(missing, ','), ',')
      where game_id = p_game_id and athlete_id = score_row.athlete_id;
      continue;
    end if;
    update public.normalized_player_game_stats set complete = true, missing_stats = '{}'
    where game_id = p_game_id and athlete_id = score_row.athlete_id;
    for event_row in
      select * from beta_private.score_beta_stat_line(score_row.ruleset_id, game_row.sport, score_row.positions, score_row.stats)
    loop
      select coalesce(sum(points), 0) into current_points
      from public.fantasy_point_events
      where fantasy_team_id = score_row.fantasy_team_id and athlete_id = score_row.athlete_id and game_id = p_game_id
        and stat_key = event_row.stat_key and kind in ('score', 'correction');
      if event_row.points <> current_points then
        insert into public.fantasy_point_events(league_id, fantasy_team_id, athlete_id, game_id, ruleset_id, stat_key, stat_value, points, kind, source_identity)
        values(score_row.league_id, score_row.fantasy_team_id, score_row.athlete_id, p_game_id, score_row.ruleset_id, event_row.stat_key, event_row.stat_value, event_row.points - current_points, case when current_points = 0 then 'score'::public.point_event_kind else 'correction'::public.point_event_kind end, p_source_identity);
        inserted_count := inserted_count + 1;
      end if;
    end loop;
  end loop;
  update public.games set stats_complete = not incomplete where id = p_game_id;
  update public.matchups matchup set
    home_points = coalesce((select sum(events.points) from public.fantasy_point_events events join public.games event_game on event_game.id = events.game_id where events.fantasy_team_id = matchup.home_team_id and event_game.starts_at >= matchup.starts_at and event_game.starts_at < matchup.ends_at), 0),
    away_points = coalesce((select sum(events.points) from public.fantasy_point_events events join public.games event_game on event_game.id = events.game_id where events.fantasy_team_id = matchup.away_team_id and event_game.starts_at >= matchup.starts_at and event_game.starts_at < matchup.ends_at), 0)
  where matchup.league_id in (select distinct league_id from public.game_lineup_snapshots where athlete_id in (select athlete_id from public.normalized_player_game_stats where game_id = p_game_id));
  return jsonb_build_object('events_inserted', inserted_count, 'incomplete', incomplete);
end;
$$;

create or replace function beta_private.acquire(team uuid,incoming uuid,outgoing uuid,kind public.transaction_type) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; slot text; tx uuid; begin
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=team;
  perform beta_private.league_lock(l.id); perform beta_private.snapshot_locks(l.id);
  if beta_private.is_locked(l.id,incoming) then raise exception 'Incoming athlete is locked until their game finishes'; end if;
  if l.status<>'active' then raise exception 'League is not active'; end if;
  if not exists(select 1 from public.player_pools p join public.pool_competitions pc on pc.pool_id=p.id join public.athlete_seasons a on a.competition_id=pc.competition_id and a.season_id=p.season_id where p.id=l.pool_id and a.athlete_id=incoming and a.draft_eligible and a.directory_visible and exists(select 1 from public.athletes athlete where athlete.id=a.athlete_id and athlete.status='active' and athlete.fantasy_withdrawn_at is null)) then raise exception 'Ineligible athlete'; end if;
  if exists(select 1 from public.roster_entries where league_id=l.id and athlete_id=incoming and released_at is null) then raise exception 'Athlete is owned'; end if;
  if beta_private.waiver_after(l.id,incoming)>clock_timestamp() then raise exception 'Athlete is on waivers'; end if;
  if outgoing is not null then
    if beta_private.is_locked(l.id,outgoing) then raise exception 'Dropped athlete is locked until their game finishes'; end if;
    update public.roster_entries set released_at=clock_timestamp() where fantasy_team_id=team and athlete_id=outgoing and released_at is null;
    if not found then raise exception 'Dropped athlete is not on this roster'; end if;
  end if;
  if (select count(*) from public.roster_entries where fantasy_team_id=team and released_at is null)>=10 then raise exception 'Roster is full'; end if;
  select sr.slot_code into slot from public.roster_slot_rules sr join public.player_pools p on p.id=l.pool_id join public.athlete_seasons a on a.season_id=p.season_id and a.athlete_id=incoming
  where sr.ruleset_id=l.ruleset_id and a.positions && sr.allowed_positions and (select count(*) from public.roster_entries r where r.fantasy_team_id=team and r.slot_code=sr.slot_code and r.released_at is null)<sr.slot_count order by sr.is_starter desc,sr.slot_code limit 1;
  if slot is null then raise exception 'Athlete cannot fit an available slot'; end if;
  insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type) values(l.id,team,incoming,slot,case when slot='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end,kind);
  insert into public.roster_transactions(league_id,fantasy_team_id,transaction_type,athlete_in_id,athlete_out_id,initiated_by) values(l.id,team,kind,incoming,outgoing,auth.uid()) returning id into tx;
  update public.leagues set state_version=state_version+1 where id=l.id;return tx;
end $$;

create or replace function beta_private.rebalance_beta_roster(p_fantasy_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  league_row public.leagues%rowtype;
  candidates jsonb;
  slots jsonb;
  owners jsonb := '{}'::jsonb;
  assignment record;
begin
  select league.* into league_row
  from public.leagues league join public.fantasy_teams team on team.league_id = league.id
  where team.id = p_fantasy_team_id;
  select jsonb_agg(jsonb_build_object('id', entry.athlete_id, 'positions', membership.positions, 'owner', p_fantasy_team_id) order by entry.acquired_at, entry.id)
  into candidates
  from public.roster_entries entry
  join public.player_pools pool on pool.id = league_row.pool_id
  join public.athlete_seasons membership on membership.athlete_id = entry.athlete_id and membership.season_id = pool.season_id
  where entry.fantasy_team_id = p_fantasy_team_id and entry.released_at is null and not beta_private.is_locked(league_row.id,entry.athlete_id);
  select jsonb_agg(jsonb_build_object('team', p_fantasy_team_id, 'code', rule.slot_code, 'positions', rule.allowed_positions) order by rule.slot_code, series.n)
  into slots
  from public.roster_slot_rules rule
  cross join lateral generate_series(1, rule.slot_count) series(n)
  where rule.ruleset_id = league_row.ruleset_id and rule.is_starter
    and not exists(select 1 from public.roster_entries r where r.fantasy_team_id=p_fantasy_team_id and r.released_at is null and r.slot_code=rule.slot_code and beta_private.is_locked(league_row.id,r.athlete_id));
  candidates:=coalesce(candidates,'[]'::jsonb); slots:=coalesce(slots,'[]'::jsonb);
  if (select count(*) from public.roster_entries where fantasy_team_id=p_fantasy_team_id and released_at is null) <> 10 then raise exception 'Roster cannot be assigned'; end if;
  for i in 0..jsonb_array_length(slots) - 1 loop
    owners := beta_private.match_slot(i, candidates, slots, owners, '{}');
    if owners is null then raise exception 'Trade would leave a roster without required starter positions'; end if;
  end loop;
  update public.roster_entries
  set slot_code = 'BN', status = 'bench'
  where fantasy_team_id = p_fantasy_team_id and released_at is null and not beta_private.is_locked(league_row.id,athlete_id);
  for assignment in select key::uuid athlete_id, value::integer slot_index from jsonb_each_text(owners) loop
    update public.roster_entries
    set slot_code = slots -> assignment.slot_index ->> 'code', status = 'starter'
    where fantasy_team_id = p_fantasy_team_id and athlete_id = assignment.athlete_id and released_at is null;
  end loop;
end;
$$;

create or replace function public.process_due_trades(p_league_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  trade_row public.trades%rowtype;
  item_row record;
  moved integer := 0;
  trade_moved integer;
  completed integer := 0;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'Worker access required'; end if;
  perform beta_private.league_lock(p_league_id);
  perform beta_private.snapshot_locks(p_league_id);
  for trade_row in select * from public.trades
    where league_id = p_league_id and status = 'accepted' and execution_status in ('review', 'locked')
      and review_ends_at <= clock_timestamp()
    order by review_ends_at, id limit least(greatest(p_limit, 1), 500) for update skip locked
  loop
    trade_moved := 0;
    if exists(select 1 from public.roster_entries entry where entry.fantasy_team_id in (trade_row.proposing_team_id, trade_row.receiving_team_id)
      and entry.released_at is null and exists(select 1 from public.trade_items ti where ti.trade_id=trade_row.id and ti.athlete_id=entry.athlete_id) and beta_private.is_locked(trade_row.league_id, entry.athlete_id)) then
      update public.trades set execution_status = 'locked' where id = trade_row.id;
      continue;
    end if;
    if exists(select 1 from public.trade_items trade_item where trade_item.trade_id = trade_row.id and not exists(
      select 1 from public.roster_entries entry where entry.fantasy_team_id = trade_item.from_team_id and entry.athlete_id = trade_item.athlete_id and entry.released_at is null
    )) then
      update public.trades set execution_status = 'conflicted' where id = trade_row.id;
      continue;
    end if;
    if exists(select 1 from public.fantasy_teams team where team.id in (trade_row.proposing_team_id, trade_row.receiving_team_id)
      and (select count(*) from public.roster_entries entry where entry.fantasy_team_id = team.id and entry.released_at is null)
        - (select count(*) from public.trade_items trade_item where trade_item.trade_id = trade_row.id and trade_item.from_team_id = team.id)
        + (select count(*) from public.trade_items trade_item where trade_item.trade_id = trade_row.id and trade_item.to_team_id = team.id) > 10) then
      update public.trades set execution_status = 'conflicted' where id = trade_row.id;
      continue;
    end if;
    begin
      for item_row in select * from public.trade_items where trade_id = trade_row.id order by athlete_id loop
        -- - Close ownership intervals so delayed fixtures cannot credit a later owner
        with released as (
          update public.roster_entries set released_at=clock_timestamp()
          where fantasy_team_id=item_row.from_team_id and athlete_id=item_row.athlete_id and released_at is null returning *
        )
        insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquired_at,acquisition_type)
        select league_id,item_row.to_team_id,athlete_id,slot_code,status,clock_timestamp(),'trade' from released;
        insert into public.roster_transactions(league_id, fantasy_team_id, transaction_type, athlete_in_id, initiated_by, metadata)
        values(trade_row.league_id, item_row.to_team_id, 'trade', item_row.athlete_id, null, jsonb_build_object('trade_id', trade_row.id));
        moved := moved + 1;
        trade_moved := trade_moved + 1;
      end loop;
      perform beta_private.rebalance_beta_roster(trade_row.proposing_team_id);
      perform beta_private.rebalance_beta_roster(trade_row.receiving_team_id);
      update public.trades set execution_status = 'completed', completed_at = clock_timestamp() where id = trade_row.id;
      update public.leagues set state_version = state_version + 1 where id = trade_row.league_id;
      perform beta_private.audit('trade.completed', 'trade', trade_row.id::text, null, jsonb_build_object('moved_athletes', trade_moved));
      completed := completed + 1;
    exception when others then
      update public.trades set execution_status = 'conflicted' where id = trade_row.id;
      perform beta_private.audit('trade.conflicted', 'trade', trade_row.id::text, null, jsonb_build_object('reason', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('completed', completed, 'moved_athletes', moved);
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

select cron.schedule('brock-projection-alerts','*/15 * * * *','select beta_private.refresh_projection_alerts();');
notify pgrst,'reload schema';

update public.player_pools set state_version=state_version+1;
