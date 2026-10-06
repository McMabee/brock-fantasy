-- Administrative previews are read-only. Trade acceptance is deliberately split
-- from execution so locks, the review period, and a veto can be enforced later.
create function public.preview_game_revision(
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
  if game_row.state_version <> p_expected_version then raise exception 'Game changed; reload and retry' using errcode = '40001'; end if;
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
    select coalesce(sum(points), 0) into previous_points
    from public.fantasy_point_events
    where game_id = p_game_id and athlete_id = athlete and kind in ('score', 'correction');
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

alter function public.propose_trade(uuid, uuid, uuid[], uuid[], timestamptz, text) rename to legacy_propose_trade;
revoke all on function public.legacy_propose_trade(uuid, uuid, uuid[], uuid[], timestamptz, text) from public, anon, authenticated, service_role;

create function public.propose_trade(
  p_proposing_team_id uuid,
  p_receiving_team_id uuid,
  p_offered_athlete_ids uuid[],
  p_requested_athlete_ids uuid[],
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  league_row public.leagues%rowtype;
  deadline timestamptz;
  trade_id uuid;
  athlete uuid;
begin
  select league.* into league_row
  from public.leagues league join public.fantasy_teams team on team.league_id = league.id
  where team.id = p_proposing_team_id;
  if league_row.pool_id is null then
    return public.legacy_propose_trade(p_proposing_team_id, p_receiving_team_id, p_offered_athlete_ids, p_requested_athlete_ids, p_expires_at, p_idempotency_key);
  end if;
  existing := beta_private.begin_command('propose_trade', p_idempotency_key);
  if existing is not null then return existing; end if;
  perform beta_private.league_lock(league_row.id);
  if not public.owns_fantasy_team(p_proposing_team_id) then raise exception 'Proposing team owner access required'; end if;
  if league_row.status <> 'active' then raise exception 'Active beta league required'; end if;
  select trade_deadline into deadline from public.fantasy_seasons season join public.player_pools pool on pool.season_id = season.id where pool.id = league_row.pool_id;
  if clock_timestamp() >= deadline then raise exception 'The trade deadline has passed'; end if;
  if p_proposing_team_id = p_receiving_team_id
    or coalesce(cardinality(p_offered_athlete_ids), 0) = 0
    or coalesce(cardinality(p_requested_athlete_ids), 0) = 0 then
    raise exception 'A trade requires different teams and at least one athlete from each team';
  end if;
  if cardinality(p_offered_athlete_ids) <> (select count(distinct value) from unnest(p_offered_athlete_ids) value)
    or cardinality(p_requested_athlete_ids) <> (select count(distinct value) from unnest(p_requested_athlete_ids) value) then
    raise exception 'Trade contains duplicate athletes';
  end if;
  if not exists(select 1 from public.fantasy_teams where id = p_receiving_team_id and league_id = league_row.id) then
    raise exception 'Teams are not in the same league';
  end if;
  if exists(select 1 from unnest(p_offered_athlete_ids) value where not exists(
    select 1 from public.roster_entries entry where entry.fantasy_team_id = p_proposing_team_id and entry.athlete_id = value and entry.released_at is null
  )) or exists(select 1 from unnest(p_requested_athlete_ids) value where not exists(
    select 1 from public.roster_entries entry where entry.fantasy_team_id = p_receiving_team_id and entry.athlete_id = value and entry.released_at is null
  )) then
    raise exception 'Every traded athlete must remain on the stated roster';
  end if;
  insert into public.trades(league_id, proposing_team_id, receiving_team_id, proposed_by, expires_at, execution_status)
  values(league_row.id, p_proposing_team_id, p_receiving_team_id, auth.uid(), least(p_expires_at, deadline), 'pending')
  returning id into trade_id;
  foreach athlete in array p_offered_athlete_ids loop
    insert into public.trade_items values(trade_id, p_proposing_team_id, p_receiving_team_id, athlete);
  end loop;
  foreach athlete in array p_requested_athlete_ids loop
    insert into public.trade_items values(trade_id, p_receiving_team_id, p_proposing_team_id, athlete);
  end loop;
  update public.leagues set state_version = state_version + 1 where id = league_row.id;
  perform beta_private.audit('trade.proposed', 'trade', trade_id::text, null, jsonb_build_object('deadline', deadline), p_idempotency_key);
  return beta_private.finish_command('propose_trade', p_idempotency_key, jsonb_build_object('trade_id', trade_id, 'status', 'proposed', 'execution_status', 'pending'));
end;
$$;

alter function public.respond_to_trade(uuid, boolean, text) rename to legacy_respond_to_trade;
revoke all on function public.legacy_respond_to_trade(uuid, boolean, text) from public, anon, authenticated, service_role;

create function public.respond_to_trade(p_trade_id uuid, p_accept boolean, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  trade_row public.trades%rowtype;
  deadline timestamptz;
  locks boolean;
begin
  select * into trade_row from public.trades where id = p_trade_id;
  if not exists(select 1 from public.leagues where id = trade_row.league_id and pool_id is not null) then
    return public.legacy_respond_to_trade(p_trade_id, p_accept, p_idempotency_key);
  end if;
  existing := beta_private.begin_command('respond_to_trade', p_idempotency_key);
  if existing is not null then return existing; end if;
  perform beta_private.league_lock(trade_row.league_id);
  select * into trade_row from public.trades where id = p_trade_id for update;
  if trade_row.id is null or trade_row.status <> 'proposed' then raise exception 'Trade is no longer open'; end if;
  if not public.owns_fantasy_team(trade_row.receiving_team_id) then raise exception 'Receiving team owner access required'; end if;
  select season.trade_deadline into deadline from public.leagues league join public.player_pools pool on pool.id = league.pool_id join public.fantasy_seasons season on season.id = pool.season_id where league.id = trade_row.league_id;
  if not p_accept then
    update public.trades set status = 'rejected', responded_at = clock_timestamp(), execution_status = 'vetoed' where id = p_trade_id;
    perform beta_private.audit('trade.rejected', 'trade', p_trade_id::text, null, '{}'::jsonb, p_idempotency_key);
    return beta_private.finish_command('respond_to_trade', p_idempotency_key, jsonb_build_object('trade_id', p_trade_id, 'status', 'rejected'));
  end if;
  if clock_timestamp() >= deadline or trade_row.expires_at <= clock_timestamp() then raise exception 'Trade acceptance deadline has passed'; end if;
  select exists(select 1 from public.trade_items item where item.trade_id = p_trade_id and beta_private.is_locked(trade_row.league_id, item.athlete_id)) into locks;
  update public.trades
  set status = 'accepted', responded_at = clock_timestamp(), review_ends_at = clock_timestamp() + interval '24 hours', execution_status = case when locks then 'locked' else 'review' end
  where id = p_trade_id;
  update public.leagues set state_version = state_version + 1 where id = trade_row.league_id;
  perform beta_private.audit('trade.accepted', 'trade', p_trade_id::text, null, jsonb_build_object('review_ends_at', clock_timestamp() + interval '24 hours', 'locked', locks), p_idempotency_key);
  return beta_private.finish_command('respond_to_trade', p_idempotency_key, jsonb_build_object('trade_id', p_trade_id, 'status', 'accepted', 'execution_status', case when locks then 'locked' else 'review' end));
end;
$$;

create function public.vote_trade(p_trade_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  trade_row public.trades%rowtype;
  threshold integer;
  vote_count integer;
  size integer;
begin
  existing := beta_private.begin_command('vote_trade', p_idempotency_key);
  if existing is not null then return existing; end if;
  select * into trade_row from public.trades where id = p_trade_id for update;
  if trade_row.id is null or trade_row.status <> 'accepted' or trade_row.review_ends_at <= clock_timestamp() then raise exception 'Trade is not open for review'; end if;
  if not public.is_league_member(trade_row.league_id) or exists(select 1 from public.fantasy_teams team where team.id in (trade_row.proposing_team_id, trade_row.receiving_team_id) and team.owner_id = auth.uid()) then
    raise exception 'Only uninvolved league managers can vote';
  end if;
  insert into public.trade_votes(trade_id, user_id) values(p_trade_id, auth.uid()) on conflict do nothing;
  select max_members into size from public.leagues where id = trade_row.league_id;
  threshold := case size when 4 then 2 when 6 then 3 when 8 then 4 when 10 then 4 else 4 end;
  select count(*) into vote_count from public.trade_votes where trade_id = p_trade_id;
  if vote_count >= threshold then
    update public.trades set execution_status = 'vetoed' where id = p_trade_id;
  end if;
  perform beta_private.audit('trade.vote', 'trade', p_trade_id::text, null, jsonb_build_object('votes', vote_count, 'threshold', threshold), p_idempotency_key);
  return beta_private.finish_command('vote_trade', p_idempotency_key, jsonb_build_object('trade_id', p_trade_id, 'votes', vote_count, 'threshold', threshold, 'execution_status', case when vote_count >= threshold then 'vetoed' else trade_row.execution_status end));
end;
$$;

create function beta_private.rebalance_beta_roster(p_fantasy_team_id uuid)
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
  where entry.fantasy_team_id = p_fantasy_team_id and entry.released_at is null;
  select jsonb_agg(jsonb_build_object('team', p_fantasy_team_id, 'code', rule.slot_code, 'positions', rule.allowed_positions) order by rule.slot_code, series.n)
  into slots
  from public.roster_slot_rules rule
  cross join lateral generate_series(1, rule.slot_count) series(n)
  where rule.ruleset_id = league_row.ruleset_id and rule.is_starter;
  if jsonb_array_length(candidates) <> 10 or slots is null then raise exception 'Roster cannot be assigned'; end if;
  for i in 0..jsonb_array_length(slots) - 1 loop
    owners := beta_private.match_slot(i, candidates, slots, owners, '{}');
    if owners is null then raise exception 'Trade would leave a roster without required starter positions'; end if;
  end loop;
  update public.roster_entries
  set slot_code = 'BN', status = 'bench'
  where fantasy_team_id = p_fantasy_team_id and released_at is null;
  for assignment in select key::uuid athlete_id, value::integer slot_index from jsonb_each_text(owners) loop
    update public.roster_entries
    set slot_code = slots -> assignment.slot_index ->> 'code', status = 'starter'
    where fantasy_team_id = p_fantasy_team_id and athlete_id = assignment.athlete_id and released_at is null;
  end loop;
end;
$$;

create function public.process_due_trades(p_league_id uuid, p_limit integer default 100)
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
  for trade_row in select * from public.trades
    where league_id = p_league_id and status = 'accepted' and execution_status in ('review', 'locked')
      and review_ends_at <= clock_timestamp()
    order by review_ends_at, id limit least(greatest(p_limit, 1), 500) for update skip locked
  loop
    trade_moved := 0;
    if exists(select 1 from public.roster_entries entry where entry.fantasy_team_id in (trade_row.proposing_team_id, trade_row.receiving_team_id)
      and entry.released_at is null and beta_private.is_locked(trade_row.league_id, entry.athlete_id)) then
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
        update public.roster_entries set fantasy_team_id = item_row.to_team_id
        where fantasy_team_id = item_row.from_team_id and athlete_id = item_row.athlete_id and released_at is null;
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

revoke all on function public.preview_game_revision(uuid, bigint, jsonb), public.vote_trade(uuid, text), public.process_due_trades(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.preview_game_revision(uuid, bigint, jsonb), public.vote_trade(uuid, text) to authenticated;
grant execute on function public.process_due_trades(uuid, integer) to service_role;
revoke all on function public.propose_trade(uuid, uuid, uuid[], uuid[], timestamptz, text), public.respond_to_trade(uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.propose_trade(uuid, uuid, uuid[], uuid[], timestamptz, text), public.respond_to_trade(uuid, boolean, text) to authenticated;
