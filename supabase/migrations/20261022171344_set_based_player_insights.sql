set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Aggregate fixtures by team once instead of repeating the same work for every athlete
create or replace function beta_private.next_period_projections(p_pool_id uuid)
returns table(athlete_id uuid,period_id uuid,period_number integer,starts_at timestamptz,ends_at timestamptz,
  season_points numeric,projected_games numeric,scheduled_games bigint,points numeric,pending boolean)
language sql stable security definer set search_path = '' as $$
with pool as materialized (
  select p.season_id,s.label from public.player_pools p join public.fantasy_seasons s on s.id=p.season_id where p.id=p_pool_id
), target as materialized (
  select fp.* from public.fantasy_periods fp join pool p on p.season_id=fp.season_id
  where fp.starts_at>clock_timestamp() order by fp.starts_at limit 1
), supplied as materialized (
  select s.athlete_id,
    case when count(*)=count(s.fantasy_points) and count(distinct s.fantasy_points)=1 then min(s.fantasy_points) end fp,
    case when count(*)=count(s.games_played) and count(distinct s.games_played)=1 then min(s.games_played) end gp
  from public.athlete_season_summaries s join pool p on p.label=s.season_label
  where s.kind='supplied_projection' group by s.athlete_id
), known as materialized (
  select distinct competition_id from public.games where schedule_kind in ('regular','playoff')
), period_games as materialized (
  select g.* from public.games g cross join target t
  where g.starts_at>=t.starts_at and g.starts_at<t.ends_at
    and g.status in ('scheduled','in_progress','final') and g.schedule_kind in ('regular','playoff')
), team_games as (
  select competition_id,home_team_id team_id,schedule_confirmed from period_games
  union all
  select competition_id,away_team_id,schedule_confirmed from period_games where away_team_id is distinct from home_team_id
), fixtures as materialized (
  select competition_id,team_id,count(*) n,bool_or(not schedule_confirmed) pending
  from team_games group by competition_id,team_id
)
select a.athlete_id,t.id,t.number,t.starts_at,t.ends_at,s.fp,s.gp,coalesce(f.n,0),
  case when t.id is null or k.competition_id is null then null when coalesce(f.n,0)=0 then 0
    when s.gp>0 and s.fp is not null then round(s.fp/s.gp*f.n,2) end,
  coalesce(f.pending,false)
from pool p join public.athlete_seasons a on a.season_id=p.season_id
left join target t on true left join supplied s on s.athlete_id=a.athlete_id
left join fixtures f on f.competition_id=a.competition_id and f.team_id=a.team_id
left join known k on k.competition_id=a.competition_id;
$$;

-- - Materialize shared work once and restrict athlete-specific aggregates before JSON construction
create or replace function rpc_private.get_player_insights(p_pool_id uuid,p_athlete_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform rpc_private.require_app_access();
  with catalog as materialized (
    select a.*,m.positions,m.team_id member_team_id,m.competition_id member_competition_id,
      c.name program,c.division::text||'_'||sport.code::text program_code,team.name team_name
    from public.player_pools p join public.fantasy_seasons fs on fs.id=p.season_id
    join public.pool_competitions pc on pc.pool_id=p.id
    join public.athlete_seasons m on m.competition_id=pc.competition_id and m.season_id=p.season_id
    join public.athletes a on a.id=m.athlete_id join public.competitions c on c.id=m.competition_id
    join public.teams team on team.id=m.team_id join public.sports sport on sport.id=c.sport_id
    where p.id=p_pool_id and p.is_active and m.directory_visible and a.status='active' and a.fantasy_withdrawn_at is null
      and (p_athlete_id is null or a.id=p_athlete_id)
  ), stats as materialized (
    select n.athlete_id,n.fantasy_points,n.stats,g.schedule_kind
    from public.normalized_player_game_stats n join catalog a on a.id=n.athlete_id
    join public.games g on g.id=n.game_id
    join public.pool_competitions pc on pc.competition_id=g.competition_id and pc.pool_id=p_pool_id
    where n.complete
  ), totals as materialized (
    select athlete_id,sum(fantasy_points) points from stats group by athlete_id
  ), stat_totals as materialized (
    select n.athlete_id,kv.key,sum((kv.value #>> '{}')::numeric) value
    from stats n cross join lateral jsonb_each(n.stats) kv
    where n.schedule_kind in ('regular','playoff') and jsonb_typeof(kv.value)='number'
    group by n.athlete_id,kv.key
  ), stat_catalog as materialized (
    select athlete_id,jsonb_object_agg(key,value) stats from stat_totals group by athlete_id
  ), projections as materialized (
    select * from beta_private.next_period_projections(p_pool_id)
  ), adp as materialized (
    select entry.key::uuid athlete_id,(entry.value->>'average')::numeric average
    from jsonb_each(beta_private.pool_adp(p_pool_id)) entry
  ), upcoming as materialized (
    select g.*,home.name home_name,away.name away_name
    from public.games g join public.teams home on home.id=g.home_team_id join public.teams away on away.id=g.away_team_id
    where g.starts_at>clock_timestamp() and g.status='scheduled' and g.schedule_kind in ('regular','playoff')
      and exists(select 1 from public.pool_competitions pc where pc.pool_id=p_pool_id and pc.competition_id=g.competition_id)
  ), team_games as (
    select g.*,g.home_team_id member_team_id,true home from upcoming g
    union all
    select g.*,g.away_team_id,false from upcoming g where g.away_team_id is distinct from g.home_team_id
  ), next_games as materialized (
    select distinct on(competition_id,member_team_id) competition_id,member_team_id,
      jsonb_build_object('id',id,'starts_at',starts_at,'status',status,'schedule_confirmed',schedule_confirmed,
        'opponent',case when home then away_name else home_name end,'home',home,'neutral',neutral_site) data
    from team_games order by competition_id,member_team_id,starts_at,id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'displayName',a.display_name,'jerseyNumber',a.jersey_number,'bio',a.bio,'position',a.position,'positions',a.positions,
    'program',a.program,'programCode',a.program_code,'team',a.team_name,'teamId',a.member_team_id,'competitionId',a.member_competition_id,
    'seasonPoints',coalesce(t.points,0),'seasonStats',coalesce(sc.stats,'{}'::jsonb),
    'seasonProjection',q.season_points,'nextProjection',q.points,'projectedGames',q.projected_games,'scheduledGames',q.scheduled_games,
    'period',case when q.period_id is null then null else jsonb_build_object('number',q.period_number,'startsAt',q.starts_at,'endsAt',q.ends_at) end,
    'pending',q.pending,'adp',adp.average,'nextGame',ng.data
  ) order by a.display_name),'[]'::jsonb) into result
  from catalog a left join projections q on q.athlete_id=a.id
  left join stat_catalog sc on sc.athlete_id=a.id left join totals t on t.athlete_id=a.id
  left join next_games ng on ng.competition_id=a.member_competition_id and ng.member_team_id=a.member_team_id
  left join adp on adp.athlete_id=a.id;
  return result;
end;
$$;

notify pgrst, 'reload schema';
