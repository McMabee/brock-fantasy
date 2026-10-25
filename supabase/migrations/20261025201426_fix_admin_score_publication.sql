set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Preserve admin MFA, version checks, audit receipts and atomic scoring
create or replace function rpc_private.publish_game_revision(
  p_game_id uuid,
  p_expected_version bigint,
  p_status public.game_status,
  p_home_score integer,
  p_away_score integer,
  p_stats jsonb,
  p_reason text,
  p_source_identity text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  game_row public.games%rowtype;
  line jsonb;
  athlete uuid;
  current_stats jsonb;
  v_import_id uuid;
  v_row_number integer := 0;
  source_identity text;
  replay jsonb;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator AAL2 access required'; end if;
  existing := beta_private.begin_command('publish_game_revision', p_idempotency_key);
  if existing is not null then return existing; end if;
  if p_reason is null or char_length(trim(p_reason)) < 8 or p_source_identity is null
    or char_length(trim(p_source_identity)) not between 3 and 2048 then
    raise exception 'An 8-character reason and a source reference between 3 and 2048 characters are required';
  end if;
  if p_home_score < 0 or p_away_score < 0 or jsonb_typeof(p_stats) <> 'array' then raise exception 'Invalid score revision'; end if;
  select * into game_row from public.games where id = p_game_id for update;
  if game_row.id is null or game_row.state_version <> p_expected_version then raise exception 'Game changed; reload and retry' using errcode = 'PT409'; end if;
  if not exists(select 1 from public.leagues l where l.pool_id is not null) or not exists(
    select 1
    from public.player_pools pool
    join public.pool_competitions pool_competition on pool_competition.pool_id = pool.id
    where pool.is_active and pool_competition.competition_id = game_row.competition_id
  ) then raise exception 'An active beta player pool is required'; end if;
  -- - Hash indexed identities and retain the full source reference in the immutable receipt
  source_identity := 'manual:' || encode(extensions.digest(trim(p_source_identity) || ':' || p_idempotency_key, 'sha256'), 'hex');
  insert into public.source_imports(source, source_hash, season_id, kind, payload, status, imported_by, published_at)
  select 'manual-admin', encode(extensions.digest(source_identity, 'sha256'), 'hex'), pool.season_id, 'game_revision', jsonb_build_object('game_id', p_game_id, 'stats', p_stats, 'reason', trim(p_reason), 'source_reference', trim(p_source_identity)), 'published', auth.uid(), clock_timestamp()
  from public.player_pools pool
  join public.pool_competitions pool_competition on pool_competition.pool_id = pool.id
  join public.fantasy_seasons season on season.id = pool.season_id
  where pool.is_active and pool_competition.competition_id = game_row.competition_id
  order by season.created_at desc, pool.id
  limit 1
  on conflict (source, source_hash) do update set published_at = excluded.published_at
  returning id into v_import_id;
  for line in select value from jsonb_array_elements(p_stats) loop
    athlete := nullif(line ->> 'athlete_id', '')::uuid;
    if athlete is null or jsonb_typeof(line -> 'stats') <> 'object' or not exists(select 1 from public.athletes where id = athlete and competition_id = game_row.competition_id) then
      raise exception 'Each stat line requires an eligible athlete and numeric stat object';
    end if;
    select stats into current_stats from public.normalized_player_game_stats where game_id = p_game_id and athlete_id = athlete for update;
    if current_stats is distinct from line -> 'stats' then
      if current_stats is not null then
        insert into public.stat_revisions(game_id, athlete_id, source_identity, previous_stats, corrected_stats)
        values(p_game_id, athlete, source_identity, current_stats, line -> 'stats');
      end if;
      insert into public.normalized_player_game_stats(game_id, athlete_id, source_identity, stats, updated_at, complete, missing_stats)
      values(p_game_id, athlete, source_identity, line -> 'stats', clock_timestamp(), false, '{}')
      on conflict (game_id, athlete_id) do update set source_identity = excluded.source_identity, stats = excluded.stats, updated_at = excluded.updated_at, complete = false, missing_stats = '{}';
    end if;
    v_row_number := v_row_number + 1;
    insert into public.source_rows(import_id, row_number, source_key, raw, normalized, entity_id)
    values(v_import_id, v_row_number, athlete::text, line, line -> 'stats', athlete);
  end loop;
  update public.games set status = p_status, home_score = p_home_score, away_score = p_away_score, manual_override = true, source_updated_at = clock_timestamp(), state_version = state_version + 1, finalized_at = case when p_status = 'final' then clock_timestamp() else finalized_at end where id = p_game_id;
  replay := public.replay_game(p_game_id, source_identity);
  perform beta_private.audit('game.revision_published', 'game', p_game_id::text, to_jsonb(game_row), jsonb_build_object('status', p_status, 'home_score', p_home_score, 'away_score', p_away_score, 'source_import_id', v_import_id, 'replay', replay, 'reason', trim(p_reason)), p_idempotency_key);
  return beta_private.finish_command('publish_game_revision', p_idempotency_key, jsonb_build_object('game_id', p_game_id, 'state_version', game_row.state_version + 1, 'replay', replay,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
      'athlete_id', n.athlete_id, 'fantasy_points', n.fantasy_points,
      'complete', n.complete, 'missing_stats', n.missing_stats
    ) order by n.athlete_id), '[]'::jsonb) from public.normalized_player_game_stats n where n.game_id = p_game_id)));
end;
$$;

create or replace function rpc_private.preview_game_revision(
  p_game_id uuid,
  p_expected_version bigint,
  p_stats jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.games%rowtype;
  v_ruleset_id uuid;
  v_sport public.sport_code;
  line jsonb;
  athlete uuid;
  positions text[];
  previous_points numeric;
  next_points numeric;
  missing text[];
  output jsonb := '[]'::jsonb;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator AAL2 access required'; end if;
  if jsonb_typeof(p_stats) <> 'array' then raise exception 'Stat lines must be an array'; end if;
  select * into game_row from public.games where id = p_game_id;
  if game_row.id is null then raise exception 'Game not found'; end if;
  if game_row.state_version <> p_expected_version then raise exception 'Game changed; reload and retry' using errcode = 'PT409'; end if;
  select pool.ruleset_id, sport.code
  into v_ruleset_id, v_sport
  from public.player_pools pool
  join public.pool_competitions pool_competition on pool_competition.pool_id = pool.id
  join public.fantasy_seasons season on season.id = pool.season_id
  join public.competitions competition on competition.id = game_row.competition_id
  join public.sports sport on sport.id = competition.sport_id
  where pool.is_active and pool_competition.competition_id = game_row.competition_id
  order by season.created_at desc, pool.id
  limit 1;
  if v_ruleset_id is null then raise exception 'An active beta player pool is required'; end if;
  for line in select value from jsonb_array_elements(p_stats) loop
    athlete := nullif(line ->> 'athlete_id', '')::uuid;
    if athlete is null or jsonb_typeof(line -> 'stats') <> 'object' then
      raise exception 'Each stat line requires an athlete and a stat object';
    end if;
    select membership.positions into positions
    from public.athlete_seasons membership
    join public.player_pools pool on pool.season_id = membership.season_id
    join public.fantasy_seasons season on season.id = pool.season_id
    where pool.ruleset_id = v_ruleset_id and membership.athlete_id = athlete
      and membership.competition_id = game_row.competition_id
    order by season.created_at desc, pool.id
    limit 1;
    if positions is null then raise exception 'An athlete does not belong to this game competition'; end if;
    -- - Compare canonical athlete points once regardless of fantasy ownership
    select coalesce((select n.fantasy_points from public.normalized_player_game_stats n
      where n.game_id = p_game_id and n.athlete_id = athlete), 0) into previous_points;
    select coalesce(sum(points), 0), array_agg(replace(stat_key, '__missing__:', '')) filter(where not complete)
    into next_points, missing
    from beta_private.score_beta_stat_line(v_ruleset_id, v_sport, positions, line -> 'stats');
    output := output || jsonb_build_array(jsonb_build_object(
      'athlete_id', athlete,
      'previous_points', previous_points,
      'projected_points', case when coalesce(cardinality(missing), 0) = 0 then next_points else null end,
      'point_difference', case when coalesce(cardinality(missing), 0) = 0 then next_points - previous_points else null end,
      'missing_stats', coalesce(to_jsonb(missing), '[]'::jsonb)
    ));
  end loop;
  return jsonb_build_object('game_id', p_game_id, 'state_version', game_row.state_version, 'players', output);
end;
$$;


-- - Count incomplete canonical lines even when the athlete has no fantasy-team snapshot
do $replay$
declare definition text; anchor text := 'update public.games set stats_complete = not incomplete where id = p_game_id;';
begin
  select pg_get_functiondef('beta_private.replay_beta_game(uuid,text)'::regprocedure) into definition;
  if position(anchor in definition) = 0 then raise exception 'Expected game completeness update'; end if;
  execute replace(definition, anchor, 'select exists(select 1 from public.normalized_player_game_stats n where n.game_id = p_game_id and not n.complete) into incomplete; ' || anchor);
end;
$replay$;

notify pgrst, 'reload schema';
