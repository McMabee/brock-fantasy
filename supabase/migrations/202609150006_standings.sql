create or replace function public.get_league_standings(p_league_id uuid)
returns table (
  rank bigint,
  fantasy_team_id uuid,
  wins bigint,
  losses bigint,
  ties bigint,
  points_for numeric,
  points_against numeric,
  standing_points bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  return query
  with team_points as (
    select ft.id,
      coalesce(sum(pe.points), 0)::numeric as points_for
    from public.fantasy_teams ft
    left join public.fantasy_point_events pe on pe.fantasy_team_id = ft.id
    where ft.league_id = p_league_id
    group by ft.id
  ),
  results as (
    select m.home_team_id as team_id,
      count(*) filter (where m.home_points > m.away_points)::bigint as wins,
      count(*) filter (where m.home_points < m.away_points)::bigint as losses,
      count(*) filter (where m.home_points = m.away_points)::bigint as ties,
      coalesce(sum(m.away_points), 0)::numeric as points_against
    from public.matchups m where m.league_id = p_league_id and m.status = 'final'
    group by m.home_team_id
    union all
    select m.away_team_id,
      count(*) filter (where m.away_points > m.home_points)::bigint,
      count(*) filter (where m.away_points < m.home_points)::bigint,
      count(*) filter (where m.away_points = m.home_points)::bigint,
      coalesce(sum(m.home_points), 0)::numeric
    from public.matchups m where m.league_id = p_league_id and m.status = 'final'
    group by m.away_team_id
  ),
  combined as (
    select tp.id,
      coalesce(sum(r.wins), 0)::bigint as wins,
      coalesce(sum(r.losses), 0)::bigint as losses,
      coalesce(sum(r.ties), 0)::bigint as ties,
      tp.points_for,
      coalesce(sum(r.points_against), 0)::numeric as points_against,
      (coalesce(sum(r.wins), 0) * 2 + coalesce(sum(r.ties), 0))::bigint as standing_points
    from team_points tp left join results r on r.team_id = tp.id
    group by tp.id, tp.points_for
  ),
  league_settings as (
    select format from public.leagues where id = p_league_id
  )
  select row_number() over (
      order by
        case when ls.format = 'head_to_head' then c.standing_points else null end desc nulls last,
        c.points_for desc,
        c.id
    ) as rank,
    c.id, c.wins, c.losses, c.ties, c.points_for, c.points_against, c.standing_points
  from combined c cross join league_settings ls
  order by rank;
end;
$$;

revoke all on function public.get_league_standings(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_league_standings(uuid) to authenticated;
