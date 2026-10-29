-- - Expose published sports information without granting access to administrator previews
create function rpc_private.get_published_preseason_ranking_seasons() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare current_label text; seasons jsonb;
begin
  perform rpc_private.require_app_access();
  select label into current_label from public.fantasy_seasons where id = beta_private.league_view_current_season();
  select coalesce(jsonb_agg(s.label order by s.label desc), '[]') into seasons
  from public.fantasy_seasons s
  join lateral (
    select p.id from public.player_pools p where p.season_id = s.id
    order by p.is_active desc, p.rankings_approved_at desc nulls last, p.id limit 1
  ) pool on true
  where s.label <= current_label and exists (
    select 1 from public.preseason_ranking_publications r where r.pool_id = pool.id
  );
  return jsonb_build_object('currentSeason', seasons->>0, 'seasons', seasons);
end;
$$;

create function rpc_private.get_published_preseason_rankings(p_season text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare selected text; selected_season_id uuid; pool uuid; publication public.preseason_ranking_publications%rowtype; rows jsonb;
begin
  perform rpc_private.require_app_access();
  selected := coalesce(p_season, rpc_private.get_published_preseason_ranking_seasons()->>'currentSeason');
  if selected is null then
    return jsonb_build_object('season', null, 'publication', null, 'rows', '[]'::jsonb);
  end if;
  if not (rpc_private.get_published_preseason_ranking_seasons()->'seasons' ? selected) then
    raise exception 'Select a published ranking season' using errcode = '22023';
  end if;
  select id into selected_season_id from public.fantasy_seasons where label = selected;
  select p.id into pool from public.player_pools p where p.season_id = selected_season_id
    order by p.is_active desc, p.rankings_approved_at desc nulls last, p.id limit 1;
  select * into publication from public.preseason_ranking_publications where pool_id = pool order by version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'athlete_id', a.id, 'name', coalesce(r.display_data->>'name', a.display_name),
    'position_group', r.position_group, 'position_rank', r.position_rank, 'projected_points', r.projected_points,
    'display_data', jsonb_build_object(
      'name', coalesce(r.display_data->>'name', a.display_name),
      'position', coalesce(r.display_data->>'position', a.position),
      'program', coalesce(r.display_data->>'program', c.division::text || '_' || sport.code::text),
      'division', coalesce(r.display_data->>'division', c.division::text),
      'bio', jsonb_build_object('headshot', coalesce(r.display_data->'bio'->'headshot', a.bio->'headshot')),
      'season_label', coalesce(r.display_data->>'season_label', selected),
      'games_played', r.display_data->'games_played', 'stats', coalesce(r.display_data->'stats', '{}'::jsonb),
      'supporting_statistics', r.display_data->'supporting_statistics'
    )) order by r.position_group, r.position_rank nulls last, a.display_name, a.id), '[]') into rows
  from public.preseason_ranking_entries r join public.athletes a on a.id = r.athlete_id and a.fantasy_withdrawn_at is null
  join public.athlete_seasons m on m.athlete_id = a.id and m.season_id = selected_season_id and m.directory_visible
  join public.competitions c on c.id = m.competition_id join public.sports sport on sport.id = c.sport_id
  where r.publication_id = publication.id;
  return jsonb_build_object('season', selected, 'publication', jsonb_build_object(
    'version', publication.version, 'published_at', publication.published_at), 'rows', rows);
end;
$$;

-- - Bound each program lookup to its current and next Brock fixture
create function rpc_private.get_upcoming_program_games(p_competition_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform rpc_private.require_app_access();
  if p_competition_ids is null or cardinality(p_competition_ids) > 32 then
    raise exception 'Select up to 32 programs' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('competition_id', c.id,
    'live', fixtures.live, 'next', fixtures.next) order by c.id), '[]') into result
  from public.competitions c
  left join lateral (
    select jsonb_agg(f.game) filter (where f.kind = 'live')->0 as live,
      jsonb_agg(f.game) filter (where f.kind = 'next')->0 as next
    from (
      select kind, (
        select jsonb_build_object('id', g.id, 'starts_at', g.starts_at, 'status', g.status,
          'schedule_confirmed', g.schedule_confirmed, 'opponent', case when home.is_brock then away.name else home.name end,
          'home', home.is_brock, 'neutral', g.neutral_site)
        from public.games g join public.teams home on home.id = g.home_team_id join public.teams away on away.id = g.away_team_id
        where g.competition_id = c.id and (home.is_brock or away.is_brock)
          and ((kind = 'live' and g.status = 'in_progress') or
            (kind = 'next' and g.status = 'scheduled' and g.starts_at > now()))
        order by g.starts_at, g.id limit 1
      ) game from (values ('live'), ('next')) kinds(kind)
    ) f
  ) fixtures on true
  where c.is_active and c.id = any(p_competition_ids);
  return result;
end;
$$;

create function public.get_published_preseason_ranking_seasons() returns jsonb language sql stable security invoker set search_path = ''
as $$ select rpc_private.get_published_preseason_ranking_seasons(); $$;
create function public.get_published_preseason_rankings(p_season text default null) returns jsonb language sql stable security invoker set search_path = ''
as $$ select rpc_private.get_published_preseason_rankings(p_season); $$;
create function public.get_upcoming_program_games(p_competition_ids uuid[]) returns jsonb language sql stable security invoker set search_path = ''
as $$ select rpc_private.get_upcoming_program_games(p_competition_ids); $$;

revoke all on function rpc_private.get_published_preseason_ranking_seasons(), rpc_private.get_published_preseason_rankings(text),
  rpc_private.get_upcoming_program_games(uuid[]), public.get_published_preseason_ranking_seasons(),
  public.get_published_preseason_rankings(text), public.get_upcoming_program_games(uuid[]) from public, anon, authenticated, service_role;
grant execute on function rpc_private.get_published_preseason_ranking_seasons(), rpc_private.get_published_preseason_rankings(text),
  rpc_private.get_upcoming_program_games(uuid[]), public.get_published_preseason_ranking_seasons(),
  public.get_published_preseason_rankings(text), public.get_upcoming_program_games(uuid[]) to authenticated;
notify pgrst, 'reload schema';
