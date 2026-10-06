-- Score the approved combined ruleset from canonical individual stat lines. A
-- completed line emits one immutable event per coefficient/bonus; later changes
-- produce compensating events rather than mutating past results.
create function beta_private.rule_points(p_ruleset_id uuid, p_stat_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select points from public.scoring_rules
  where ruleset_id = p_ruleset_id and stat_key = p_stat_key;
$$;

create function beta_private.missing_stat_keys(p_stats jsonb, p_keys text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(key order by key), '{}'::text[])
  from unnest(p_keys) as key
  where coalesce(jsonb_typeof(p_stats -> key), '') <> 'number';
$$;

create function beta_private.stat_number(p_stats jsonb, p_key text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare value numeric;
begin
  if coalesce(jsonb_typeof(p_stats -> p_key), '') <> 'number' then return null; end if;
  value := (p_stats ->> p_key)::numeric;
  if value < 0 then raise exception 'Statistic % cannot be negative', p_key using errcode = '22023'; end if;
  return value;
end;
$$;

create function beta_private.score_beta_stat_line(
  p_ruleset_id uuid,
  p_sport public.sport_code,
  p_positions text[],
  p_stats jsonb
)
returns table(stat_key text, stat_value numeric, points numeric, complete boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  missing text[];
  goals numeric; assists numeric; power_play_goals numeric; short_handed_goals numeric; penalty_minutes numeric;
  wins numeric; goals_allowed numeric; saves numeric; shutouts numeric;
  scored_points numeric; offensive_rebounds numeric; defensive_rebounds numeric; basketball_assists numeric;
  blocks numeric; steals numeric; turnovers numeric; fouls numeric; foul_out numeric;
  kills numeric; aces numeric; solo_blocks numeric; assisted_blocks numeric; volleyball_assists numeric; digs numeric; errors numeric;
begin
  if p_sport = 'hockey' and p_positions @> array['G'] then
    missing := beta_private.missing_stat_keys(p_stats, array['wins','goals_allowed','saves','shutouts']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    wins := beta_private.stat_number(p_stats, 'wins'); goals_allowed := beta_private.stat_number(p_stats, 'goals_allowed');
    saves := beta_private.stat_number(p_stats, 'saves'); shutouts := beta_private.stat_number(p_stats, 'shutouts');
    return query values
      ('goalie.wins', wins, wins * beta_private.rule_points(p_ruleset_id, 'goalie.wins'), true),
      ('goalie.goals_allowed', goals_allowed, goals_allowed * beta_private.rule_points(p_ruleset_id, 'goalie.goals_allowed'), true),
      ('goalie.saves', saves, saves * beta_private.rule_points(p_ruleset_id, 'goalie.saves'), true),
      ('goalie.shutouts', shutouts, shutouts * beta_private.rule_points(p_ruleset_id, 'goalie.shutouts'), true);
    return;
  elsif p_sport = 'hockey' then
    missing := beta_private.missing_stat_keys(p_stats, array['goals','assists','power_play_goals','short_handed_goals','penalty_minutes']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    goals := beta_private.stat_number(p_stats, 'goals'); assists := beta_private.stat_number(p_stats, 'assists');
    power_play_goals := beta_private.stat_number(p_stats, 'power_play_goals'); short_handed_goals := beta_private.stat_number(p_stats, 'short_handed_goals'); penalty_minutes := beta_private.stat_number(p_stats, 'penalty_minutes');
    return query values
      ('skater.goals', goals, goals * beta_private.rule_points(p_ruleset_id, 'skater.goals'), true),
      ('skater.assists', assists, assists * beta_private.rule_points(p_ruleset_id, 'skater.assists'), true),
      ('skater.power_play_goals', power_play_goals, power_play_goals * beta_private.rule_points(p_ruleset_id, 'skater.power_play_goals'), true),
      ('skater.short_handed_goals', short_handed_goals, short_handed_goals * beta_private.rule_points(p_ruleset_id, 'skater.short_handed_goals'), true),
      ('skater.penalty_minutes', penalty_minutes, penalty_minutes * beta_private.rule_points(p_ruleset_id, 'skater.penalty_minutes'), true),
      ('skater.multi_point', case when goals + assists >= 2 then 1 else 0 end, case when goals + assists >= 2 then beta_private.rule_points(p_ruleset_id, 'skater.multi_point') else 0 end, true);
    return;
  elsif p_sport = 'basketball' then
    missing := beta_private.missing_stat_keys(p_stats, array['points','offensive_rebounds','defensive_rebounds','assists','blocks','steals','turnovers','fouls','foul_out']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    scored_points := beta_private.stat_number(p_stats, 'points'); offensive_rebounds := beta_private.stat_number(p_stats, 'offensive_rebounds');
    defensive_rebounds := beta_private.stat_number(p_stats, 'defensive_rebounds'); basketball_assists := beta_private.stat_number(p_stats, 'assists');
    blocks := beta_private.stat_number(p_stats, 'blocks'); steals := beta_private.stat_number(p_stats, 'steals'); turnovers := beta_private.stat_number(p_stats, 'turnovers'); fouls := beta_private.stat_number(p_stats, 'fouls'); foul_out := beta_private.stat_number(p_stats, 'foul_out');
    return query values
      ('basketball.points', scored_points, scored_points * beta_private.rule_points(p_ruleset_id, 'basketball.points'), true),
      ('basketball.offensive_rebounds', offensive_rebounds, offensive_rebounds * beta_private.rule_points(p_ruleset_id, 'basketball.offensive_rebounds'), true),
      ('basketball.defensive_rebounds', defensive_rebounds, defensive_rebounds * beta_private.rule_points(p_ruleset_id, 'basketball.defensive_rebounds'), true),
      ('basketball.assists', basketball_assists, basketball_assists * beta_private.rule_points(p_ruleset_id, 'basketball.assists'), true),
      ('basketball.blocks', blocks, blocks * beta_private.rule_points(p_ruleset_id, 'basketball.blocks'), true),
      ('basketball.steals', steals, steals * beta_private.rule_points(p_ruleset_id, 'basketball.steals'), true),
      ('basketball.turnovers', turnovers, turnovers * beta_private.rule_points(p_ruleset_id, 'basketball.turnovers'), true),
      ('basketball.fouls', fouls, fouls * beta_private.rule_points(p_ruleset_id, 'basketball.fouls'), true),
      ('basketball.foul_out', foul_out, foul_out * beta_private.rule_points(p_ruleset_id, 'basketball.foul_out'), true),
      ('basketball.double_double', case when (case when scored_points >= 10 then 1 else 0 end + case when offensive_rebounds + defensive_rebounds >= 10 then 1 else 0 end + case when basketball_assists >= 10 then 1 else 0 end + case when steals >= 10 then 1 else 0 end + case when blocks >= 10 then 1 else 0 end) >= 2 then 1 else 0 end, case when (case when scored_points >= 10 then 1 else 0 end + case when offensive_rebounds + defensive_rebounds >= 10 then 1 else 0 end + case when basketball_assists >= 10 then 1 else 0 end + case when steals >= 10 then 1 else 0 end + case when blocks >= 10 then 1 else 0 end) >= 2 then beta_private.rule_points(p_ruleset_id, 'basketball.double_double') else 0 end, true);
    return;
  elsif p_sport = 'volleyball' then
    missing := beta_private.missing_stat_keys(p_stats, array['kills','aces','solo_blocks','assisted_blocks','assists','digs','attack_errors','service_errors','reception_errors','setting_errors','ball_handling_errors','blocking_errors']);
    if cardinality(missing) > 0 then
      return query select '__missing__:' || array_to_string(missing, ','), 0::numeric, 0::numeric, false;
      return;
    end if;
    kills := beta_private.stat_number(p_stats, 'kills'); aces := beta_private.stat_number(p_stats, 'aces'); solo_blocks := beta_private.stat_number(p_stats, 'solo_blocks'); assisted_blocks := beta_private.stat_number(p_stats, 'assisted_blocks'); volleyball_assists := beta_private.stat_number(p_stats, 'assists'); digs := beta_private.stat_number(p_stats, 'digs');
    errors := beta_private.stat_number(p_stats, 'attack_errors') + beta_private.stat_number(p_stats, 'service_errors') + beta_private.stat_number(p_stats, 'reception_errors') + beta_private.stat_number(p_stats, 'setting_errors') + beta_private.stat_number(p_stats, 'ball_handling_errors') + beta_private.stat_number(p_stats, 'blocking_errors');
    return query values
      ('volleyball.kills', kills, kills * beta_private.rule_points(p_ruleset_id, 'volleyball.kills'), true),
      ('volleyball.aces', aces, aces * beta_private.rule_points(p_ruleset_id, 'volleyball.aces'), true),
      ('volleyball.solo_blocks', solo_blocks, solo_blocks * beta_private.rule_points(p_ruleset_id, 'volleyball.solo_blocks'), true),
      ('volleyball.assisted_blocks', assisted_blocks, assisted_blocks * beta_private.rule_points(p_ruleset_id, 'volleyball.assisted_blocks'), true),
      ('volleyball.assists', volleyball_assists, volleyball_assists * beta_private.rule_points(p_ruleset_id, 'volleyball.assists'), true),
      ('volleyball.digs', digs, digs * beta_private.rule_points(p_ruleset_id, 'volleyball.digs'), true),
      ('volleyball.errors', errors, errors * beta_private.rule_points(p_ruleset_id, 'volleyball.errors'), true),
      ('volleyball.hitter_bonus', case when p_positions && array['HT'] and kills >= 10 then 1 else 0 end, case when p_positions && array['HT'] and kills >= 10 then beta_private.rule_points(p_ruleset_id, 'volleyball.hitter_bonus') else 0 end, true),
      ('volleyball.setter_bonus', case when p_positions && array['S'] and volleyball_assists >= 40 then 1 else 0 end, case when p_positions && array['S'] and volleyball_assists >= 40 then beta_private.rule_points(p_ruleset_id, 'volleyball.setter_bonus') else 0 end, true),
      ('volleyball.libero_bonus', case when p_positions && array['L'] and digs >= 8 then 1 else 0 end, case when p_positions && array['L'] and digs >= 8 then beta_private.rule_points(p_ruleset_id, 'volleyball.libero_bonus') else 0 end, true);
    return;
  end if;
  raise exception 'Unsupported sport %', p_sport using errcode = '22023';
end;
$$;

create function beta_private.replay_beta_game(p_game_id uuid, p_source_identity text)
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
  for update;
  if game_row.id is null then raise exception 'Game not found'; end if;

  perform beta_private.snapshot_locks(l.id)
  from public.leagues l where l.pool_id is not null and exists (
    select 1 from public.player_pools p join public.pool_competitions pc on pc.pool_id = p.id
    where p.id = l.pool_id and pc.competition_id = game_row.competition_id
  );

  for score_row in
    select pll.league_id, pll.fantasy_team_id, pll.athlete_id, l.ruleset_id, membership.positions, stats.stats
    from public.period_lineup_locks pll
    join public.leagues l on l.id = pll.league_id and l.pool_id is not null
    join public.player_pools pool on pool.id = l.pool_id
    join public.fantasy_periods period on period.id = pll.period_id
    join public.athlete_seasons membership on membership.athlete_id = pll.athlete_id and membership.season_id = pool.season_id and membership.competition_id = game_row.competition_id
    join public.normalized_player_game_stats stats on stats.game_id = p_game_id and stats.athlete_id = pll.athlete_id
    join public.games game on game.id = p_game_id and game.starts_at >= period.starts_at and game.starts_at < period.ends_at
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
  where matchup.league_id in (select distinct league_id from public.period_lineup_locks where athlete_id in (select athlete_id from public.normalized_player_game_stats where game_id = p_game_id));
  return jsonb_build_object('events_inserted', inserted_count, 'incomplete', incomplete);
end;
$$;

alter function public.replay_game(uuid,text) rename to legacy_replay_game;
revoke all on function public.legacy_replay_game(uuid,text) from public,anon,authenticated,service_role;
create function public.replay_game(p_game_id uuid, p_source_identity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_is_admin() and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Administrator or service access required';
  end if;
  if exists(
    select 1 from public.games g join public.leagues l on l.pool_id is not null
    join public.player_pools p on p.id = l.pool_id join public.pool_competitions pc on pc.pool_id = p.id and pc.competition_id = g.competition_id
    where g.id = p_game_id
  ) then
    return beta_private.replay_beta_game(p_game_id, p_source_identity);
  end if;
  return public.legacy_replay_game(p_game_id, p_source_identity);
end;
$$;

create function public.publish_game_revision(
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
  source_identity text;
  replay jsonb;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator AAL2 access required'; end if;
  existing := beta_private.begin_command('publish_game_revision', p_idempotency_key);
  if existing is not null then return existing; end if;
  if char_length(trim(p_reason)) < 8 or char_length(trim(p_source_identity)) not between 3 and 100 then
    raise exception 'A detailed reason and source reference are required';
  end if;
  if p_home_score < 0 or p_away_score < 0 or jsonb_typeof(p_stats) <> 'array' then raise exception 'Invalid score revision'; end if;
  select * into game_row from public.games where id = p_game_id for update;
  if game_row.id is null or game_row.state_version <> p_expected_version then raise exception 'Game changed; reload and retry' using errcode = '40001'; end if;
  if not exists(select 1 from public.leagues l where l.pool_id is not null) or not exists(
    select 1
    from public.player_pools pool
    join public.pool_competitions pool_competition on pool_competition.pool_id = pool.id
    where pool.is_active and pool_competition.competition_id = game_row.competition_id
  ) then raise exception 'An active beta player pool is required'; end if;
  source_identity := 'manual:' || trim(p_source_identity) || ':' || p_idempotency_key;
  insert into public.source_imports(source, source_hash, season_id, kind, payload, status, imported_by, published_at)
  select 'manual-admin', encode(extensions.digest(source_identity, 'sha256'), 'hex'), pool.season_id, 'game_revision', jsonb_build_object('game_id', p_game_id, 'stats', p_stats, 'reason', trim(p_reason)), 'published', auth.uid(), clock_timestamp()
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
    insert into public.source_rows(import_id, row_number, source_key, raw, normalized, entity_id)
    values(v_import_id, (select count(*) + 1 from public.source_rows rows where rows.import_id = v_import_id), athlete::text, line, line -> 'stats', athlete);
  end loop;
  update public.games set status = p_status, home_score = p_home_score, away_score = p_away_score, manual_override = true, source_updated_at = clock_timestamp(), state_version = state_version + 1, finalized_at = case when p_status = 'final' then clock_timestamp() else finalized_at end where id = p_game_id;
  replay := public.replay_game(p_game_id, source_identity);
  perform beta_private.audit('game.revision_published', 'game', p_game_id::text, to_jsonb(game_row), jsonb_build_object('status', p_status, 'home_score', p_home_score, 'away_score', p_away_score, 'source_import_id', v_import_id, 'replay', replay, 'reason', trim(p_reason)), p_idempotency_key);
  return beta_private.finish_command('publish_game_revision', p_idempotency_key, jsonb_build_object('game_id', p_game_id, 'state_version', game_row.state_version + 1, 'replay', replay));
end;
$$;

revoke all on function public.replay_game(uuid,text),public.publish_game_revision(uuid,bigint,public.game_status,integer,integer,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.replay_game(uuid,text) to authenticated,service_role;
grant execute on function public.publish_game_revision(uuid,bigint,public.game_status,integer,integer,jsonb,text,text,text) to authenticated;
