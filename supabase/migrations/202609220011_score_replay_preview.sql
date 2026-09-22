create or replace function public.preview_game_replay(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_game public.games%rowtype;
  v_ingestion_paused boolean := false;
  v_unresolved_errors integer := 0;
  v_source_identity text;
  v_result jsonb;
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator with MFA required';
  end if;

  select * into v_game from public.games where id = p_game_id;
  if v_game.id is null then raise exception 'Game not found'; end if;

  select coalesce(ingestion_paused, false)
  into v_ingestion_paused
  from public.competition_ingestion_controls
  where competition_id = v_game.competition_id;
  v_ingestion_paused := coalesce(v_ingestion_paused, false);

  select count(*)::integer
  into v_unresolved_errors
  from public.sync_errors se
  join public.provider_snapshots ps on ps.id = se.provider_snapshot_id
  where ps.game_id = p_game_id and se.resolved_at is null;

  select source_identity
  into v_source_identity
  from public.provider_snapshots
  where game_id = p_game_id
  order by captured_at desc, received_at desc
  limit 1;

  with targets as (
    select
      le.league_id,
      le.fantasy_team_id,
      ft.name as fantasy_team_name,
      n.athlete_id,
      a.display_name as athlete_name,
      sr.stat_key,
      sr.label as stat_label,
      coalesce((n.stats ->> sr.stat_key)::numeric, 0) as stat_value,
      round(coalesce((n.stats ->> sr.stat_key)::numeric, 0) * sr.points, 3) as target_points,
      coalesce((
        select sum(pe.points)
        from public.fantasy_point_events pe
        where pe.fantasy_team_id = le.fantasy_team_id
          and pe.athlete_id = n.athlete_id
          and pe.game_id = p_game_id
          and pe.stat_key = sr.stat_key
          and pe.kind in ('score', 'correction')
      ), 0) as current_points
    from public.normalized_player_game_stats n
    join public.lineup_entries le
      on le.game_id = n.game_id and le.athlete_id = n.athlete_id
    join public.fantasy_teams ft on ft.id = le.fantasy_team_id
    join public.athletes a on a.id = n.athlete_id
    join public.leagues l on l.id = le.league_id
    join public.scoring_rules sr on sr.ruleset_id = l.ruleset_id
    where n.game_id = p_game_id
  )
  select jsonb_build_object(
    'current_points', coalesce(sum(current_points), 0),
    'projected_points', coalesce(sum(target_points), 0),
    'delta', coalesce(sum(target_points - current_points), 0),
    'event_count', count(*) filter (where target_points <> current_points),
    'changes', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'league_id', league_id,
          'fantasy_team_id', fantasy_team_id,
          'fantasy_team_name', fantasy_team_name,
          'athlete_id', athlete_id,
          'athlete_name', athlete_name,
          'stat_key', stat_key,
          'stat_label', stat_label,
          'stat_value', stat_value,
          'current_points', current_points,
          'projected_points', target_points,
          'delta', target_points - current_points
        ) order by fantasy_team_name, athlete_name, stat_key
      ) filter (where target_points <> current_points),
      '[]'::jsonb
    )
  )
  into v_result
  from targets;

  return v_result || jsonb_build_object(
    'game_id', p_game_id,
    'game_status', v_game.status,
    'source_identity', v_source_identity,
    'ingestion_paused', v_ingestion_paused,
    'unresolved_errors', v_unresolved_errors,
    'can_replay', (
      not v_ingestion_paused
      and v_unresolved_errors = 0
      and v_source_identity is not null
    )
  );
end;
$$;

revoke all on function public.preview_game_replay(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_game_replay(uuid) to authenticated;
