create unique index waiver_claims_one_pending_per_team_athlete
  on public.waiver_claims (fantasy_team_id, athlete_in_id)
  where status = 'pending';

create or replace function public.request_waiver(
  p_fantasy_team_id uuid,
  p_athlete_in_id uuid,
  p_athlete_out_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_priority integer;
  v_process_hour integer;
  v_process_after timestamptz;
  v_claim_id uuid;
  v_existing jsonb;
  v_state_version bigint;
begin
  if v_user_id is null or not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':waiver:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys where user_id = v_user_id and command = 'request_waiver' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select l.* into v_league
  from public.leagues l join public.fantasy_teams ft on ft.league_id = l.id
  where ft.id = p_fantasy_team_id;
  select waiver_priority into v_priority
  from public.fantasy_teams
  where id = p_fantasy_team_id
  for update;
  if v_league.status <> 'active' then raise exception 'League is not active'; end if;
  if not coalesce((select (transaction_config ->> 'waiversEnabled')::boolean from public.scoring_rulesets where id = v_league.ruleset_id), false) then raise exception 'Waivers are disabled'; end if;
  if not exists (select 1 from public.athletes where id = p_athlete_in_id and competition_id = v_league.competition_id and status = 'active') then raise exception 'Athlete is not eligible'; end if;
  if exists (select 1 from public.roster_entries where league_id = v_league.id and athlete_id = p_athlete_in_id and released_at is null) then raise exception 'Athlete is already rostered'; end if;
  if p_athlete_out_id is not null and not exists (select 1 from public.roster_entries where fantasy_team_id = p_fantasy_team_id and athlete_id = p_athlete_out_id and released_at is null) then raise exception 'Dropped athlete is not on this roster'; end if;

  select coalesce((transaction_config ->> 'waiverProcessHourUtc')::integer, 12) into v_process_hour from public.scoring_rulesets where id = v_league.ruleset_id;
  v_process_after := date_trunc('day', now()) + make_interval(hours => v_process_hour);
  if v_process_after <= now() then v_process_after := v_process_after + interval '1 day'; end if;

  insert into public.waiver_claims (league_id, fantasy_team_id, athlete_in_id, athlete_out_id, priority_at_claim, process_after)
  values (v_league.id, p_fantasy_team_id, p_athlete_in_id, p_athlete_out_id, coalesce(v_priority, 2147483647), v_process_after)
  returning id into v_claim_id;
  update public.leagues set state_version = state_version + 1 where id = v_league.id
  returning state_version into v_state_version;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'request_waiver', p_idempotency_key, jsonb_build_object('claim_id', v_claim_id, 'status', 'pending', 'state_version', v_state_version));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'waiver.requested', 'waiver_claim', v_claim_id::text, jsonb_build_object('process_after', v_process_after), p_idempotency_key);
  return jsonb_build_object('claim_id', v_claim_id, 'status', 'pending', 'state_version', v_state_version);
end;
$$;

create or replace function public.process_due_waivers(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.waiver_claims%rowtype;
  v_slot_code text;
  v_roster_status public.roster_status;
  v_processed integer := 0;
  v_failed integer := 0;
  v_owner_id uuid;
  v_roster_count integer;
  v_roster_max integer;
begin
  if not public.current_user_is_admin() and session_user <> 'postgres' then raise exception 'Administrator or service access required'; end if;
  for v_claim in
    select * from public.waiver_claims
    where league_id = p_league_id and status = 'pending' and process_after <= now()
    order by athlete_in_id, priority_at_claim, created_at
    for update skip locked
  loop
    if v_claim.status <> 'pending' then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_league_id::text || ':waiver:' || v_claim.athlete_in_id::text, 0));
    if exists (select 1 from public.roster_entries where league_id = p_league_id and athlete_id = v_claim.athlete_in_id and released_at is null) then
      update public.waiver_claims set status = 'failed', processed_at = now() where id = v_claim.id;
      v_failed := v_failed + 1;
      continue;
    end if;
    select count(*) into v_roster_count from public.roster_entries where fantasy_team_id = v_claim.fantasy_team_id and released_at is null;
    select coalesce(sum(slot_count), 0)
      into v_roster_max
      from public.roster_slot_rules sr
      join public.leagues l on l.ruleset_id = sr.ruleset_id
      where l.id = p_league_id;
    if v_claim.athlete_out_id is null and v_roster_count >= v_roster_max then
      update public.waiver_claims set status = 'failed', processed_at = now() where id = v_claim.id;
      v_failed := v_failed + 1;
      continue;
    end if;
    select sr.slot_code, case when sr.is_starter then 'starter'::public.roster_status else 'bench'::public.roster_status end
    into v_slot_code, v_roster_status
    from public.roster_slot_rules sr
    join public.leagues l on l.ruleset_id = sr.ruleset_id
    join public.athletes a on a.id = v_claim.athlete_in_id
    where l.id = p_league_id
      and a.position = any(sr.allowed_positions)
      and (
        select count(*) from public.roster_entries re
        where re.fantasy_team_id = v_claim.fantasy_team_id
          and re.slot_code = sr.slot_code
          and re.released_at is null
          and (v_claim.athlete_out_id is null or re.athlete_id <> v_claim.athlete_out_id)
      ) < sr.slot_count
    order by sr.is_starter desc, sr.id
    limit 1;
    if v_slot_code is null then
      update public.waiver_claims set status = 'failed', processed_at = now() where id = v_claim.id;
      v_failed := v_failed + 1;
      continue;
    end if;
    if v_claim.athlete_out_id is not null then
      if exists (
        select 1 from public.lineup_entries le
        join public.games g on g.id = le.game_id
        where le.fantasy_team_id = v_claim.fantasy_team_id
          and le.athlete_id = v_claim.athlete_out_id
          and g.starts_at <= now()
          and g.status not in ('final', 'cancelled', 'postponed')
      ) then
        update public.waiver_claims set status = 'failed', processed_at = now() where id = v_claim.id;
        v_failed := v_failed + 1;
        continue;
      end if;
      update public.roster_entries set released_at = now()
      where fantasy_team_id = v_claim.fantasy_team_id and athlete_id = v_claim.athlete_out_id and released_at is null;
      if not found then
        update public.waiver_claims set status = 'failed', processed_at = now() where id = v_claim.id;
        v_failed := v_failed + 1;
        continue;
      end if;
    end if;
    insert into public.roster_entries (league_id, fantasy_team_id, athlete_id, slot_code, status, acquisition_type)
    values (p_league_id, v_claim.fantasy_team_id, v_claim.athlete_in_id, v_slot_code, v_roster_status, 'waiver');
    insert into public.roster_transactions (league_id, fantasy_team_id, transaction_type, athlete_in_id, athlete_out_id)
    values (p_league_id, v_claim.fantasy_team_id, 'waiver', v_claim.athlete_in_id, v_claim.athlete_out_id);
    update public.waiver_claims set status = 'successful', processed_at = now() where id = v_claim.id;
    update public.waiver_claims set status = 'failed', processed_at = now()
      where league_id = p_league_id and athlete_in_id = v_claim.athlete_in_id and status = 'pending';
    update public.fantasy_teams set waiver_priority = (select coalesce(max(waiver_priority), 0) + 1 from public.fantasy_teams where league_id = p_league_id)
      where id = v_claim.fantasy_team_id;
    select owner_id into v_owner_id from public.fantasy_teams where id = v_claim.fantasy_team_id;
    if v_owner_id is not null then
      insert into public.notifications (user_id, kind, title, body, data)
      values (v_owner_id, 'waiver_result', 'Waiver claim successful', 'Your roster has been updated.', jsonb_build_object('claim_id', v_claim.id));
    end if;
    v_processed := v_processed + 1;
  end loop;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state)
  values (auth.uid(), 'waivers.processed', 'league', p_league_id::text, jsonb_build_object('successful', v_processed, 'failed', v_failed));
  return jsonb_build_object('successful', v_processed, 'failed', v_failed);
end;
$$;

create or replace function public.propose_trade(
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
  v_user_id uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_trade_id uuid;
  v_athlete_id uuid;
  v_existing jsonb;
  v_state_version bigint;
begin
  if v_user_id is null or not public.owns_fantasy_team(p_proposing_team_id) then raise exception 'Proposing team owner access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':trade:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys where user_id = v_user_id and command = 'propose_trade' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  if p_proposing_team_id = p_receiving_team_id then raise exception 'Trade teams must be different'; end if;
  if coalesce(array_length(p_offered_athlete_ids, 1), 0) = 0 or coalesce(array_length(p_requested_athlete_ids, 1), 0) = 0 then raise exception 'Both teams must offer at least one athlete'; end if;
  if cardinality(p_offered_athlete_ids) <> (select count(distinct athlete_id) from unnest(p_offered_athlete_ids) as offered(athlete_id))
    or cardinality(p_requested_athlete_ids) <> (select count(distinct athlete_id) from unnest(p_requested_athlete_ids) as requested(athlete_id)) then
    raise exception 'Trade contains duplicate athletes';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '14 days' then raise exception 'Trade expiry must be within 14 days'; end if;
  select l.* into v_league from public.leagues l join public.fantasy_teams ft on ft.league_id = l.id where ft.id = p_proposing_team_id;
  if not exists (select 1 from public.fantasy_teams where id = p_receiving_team_id and league_id = v_league.id) then raise exception 'Teams are not in the same league'; end if;
  if not coalesce((select (transaction_config ->> 'tradesEnabled')::boolean from public.scoring_rulesets where id = v_league.ruleset_id), false) then raise exception 'Trades are disabled'; end if;
  if exists (select 1 from unnest(p_offered_athlete_ids) a where not exists (select 1 from public.roster_entries r where r.fantasy_team_id = p_proposing_team_id and r.athlete_id = a and r.released_at is null)) then raise exception 'Offered athlete is not on the proposing roster'; end if;
  if exists (select 1 from unnest(p_requested_athlete_ids) a where not exists (select 1 from public.roster_entries r where r.fantasy_team_id = p_receiving_team_id and r.athlete_id = a and r.released_at is null)) then raise exception 'Requested athlete is not on the receiving roster'; end if;

  insert into public.trades (league_id, proposing_team_id, receiving_team_id, proposed_by, expires_at)
  values (v_league.id, p_proposing_team_id, p_receiving_team_id, v_user_id, p_expires_at) returning id into v_trade_id;
  foreach v_athlete_id in array p_offered_athlete_ids loop
    insert into public.trade_items values (v_trade_id, p_proposing_team_id, p_receiving_team_id, v_athlete_id);
  end loop;
  foreach v_athlete_id in array p_requested_athlete_ids loop
    insert into public.trade_items values (v_trade_id, p_receiving_team_id, p_proposing_team_id, v_athlete_id);
  end loop;
  update public.leagues set state_version = state_version + 1 where id = v_league.id
  returning state_version into v_state_version;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'propose_trade', p_idempotency_key, jsonb_build_object('trade_id', v_trade_id, 'status', 'proposed', 'state_version', v_state_version));
  insert into public.notifications (user_id, kind, title, body, data)
  select owner_id, 'trade_proposed', 'New trade proposal', 'Review the proposed player exchange.', jsonb_build_object('trade_id', v_trade_id)
  from public.fantasy_teams where id = p_receiving_team_id and owner_id is not null;
  return jsonb_build_object('trade_id', v_trade_id, 'status', 'proposed', 'state_version', v_state_version);
end;
$$;

create or replace function public.rebalance_roster_slots(p_fantasy_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset_id uuid;
  v_entry record;
  v_slot_code text;
  v_status public.roster_status;
begin
  select l.ruleset_id into v_ruleset_id
  from public.fantasy_teams ft join public.leagues l on l.id = ft.league_id
  where ft.id = p_fantasy_team_id;
  if v_ruleset_id is null then raise exception 'Fantasy team not found'; end if;

  update public.roster_entries
  set slot_code = '__assigning__', status = 'bench'
  where fantasy_team_id = p_fantasy_team_id and released_at is null;

  for v_entry in
    select re.id, a.position
    from public.roster_entries re
    join public.athletes a on a.id = re.athlete_id
    where re.fantasy_team_id = p_fantasy_team_id and re.released_at is null
    order by (
      select count(*) from public.roster_slot_rules eligible
      where eligible.ruleset_id = v_ruleset_id and a.position = any(eligible.allowed_positions)
    ), re.acquired_at, re.id
  loop
    select sr.slot_code, case when sr.is_starter then 'starter'::public.roster_status else 'bench'::public.roster_status end
    into v_slot_code, v_status
    from public.roster_slot_rules sr
    where sr.ruleset_id = v_ruleset_id
      and v_entry.position = any(sr.allowed_positions)
      and (
        select count(*) from public.roster_entries assigned
        where assigned.fantasy_team_id = p_fantasy_team_id
          and assigned.released_at is null
          and assigned.slot_code = sr.slot_code
      ) < sr.slot_count
    order by sr.is_starter desc, sr.id
    limit 1;
    if v_slot_code is null then raise exception 'Trade would create an invalid roster'; end if;
    update public.roster_entries set slot_code = v_slot_code, status = v_status where id = v_entry.id;
  end loop;
end;
$$;

create or replace function public.respond_to_trade(p_trade_id uuid, p_accept boolean, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_item public.trade_items%rowtype;
  v_new_status public.trade_status;
  v_existing jsonb;
  v_state_version bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':trade_response:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
  where user_id = v_user_id and command = 'respond_to_trade' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trade_id::text || ':respond', 0));
  select * into v_trade from public.trades where id = p_trade_id for update;
  if v_trade.id is null or v_trade.status <> 'proposed' or v_trade.expires_at <= now() then raise exception 'Trade is no longer open'; end if;
  if not public.owns_fantasy_team(v_trade.receiving_team_id) and not public.current_user_is_admin() then raise exception 'Receiving team owner access required'; end if;
  if not p_accept then
    update public.trades set status = 'rejected', responded_at = now() where id = p_trade_id;
    v_new_status := 'rejected';
  else
    perform 1 from public.roster_entries
    where fantasy_team_id in (v_trade.proposing_team_id, v_trade.receiving_team_id) and released_at is null
    order by fantasy_team_id, athlete_id
    for update;
    if exists (
      select 1 from public.trade_items ti
      where ti.trade_id = p_trade_id and not exists (
        select 1 from public.roster_entries r where r.fantasy_team_id = ti.from_team_id and r.athlete_id = ti.athlete_id and r.released_at is null
      )
    ) then raise exception 'A traded athlete is no longer on the expected roster'; end if;
    if exists (
      select 1 from public.trade_items ti join public.lineup_entries le on le.fantasy_team_id = ti.from_team_id and le.athlete_id = ti.athlete_id
      join public.games g on g.id = le.game_id
      where ti.trade_id = p_trade_id
        and g.starts_at <= now()
        and g.status not in ('final', 'cancelled', 'postponed')
    ) then raise exception 'A traded athlete is locked in an active game'; end if;
    for v_item in select * from public.trade_items where trade_id = p_trade_id order by athlete_id for update loop
      update public.roster_entries set fantasy_team_id = v_item.to_team_id
      where fantasy_team_id = v_item.from_team_id and athlete_id = v_item.athlete_id and released_at is null;
      insert into public.roster_transactions (league_id, fantasy_team_id, transaction_type, athlete_in_id, initiated_by, metadata)
      values (v_trade.league_id, v_item.to_team_id, 'trade', v_item.athlete_id, v_user_id, jsonb_build_object('trade_id', p_trade_id));
    end loop;
    perform public.rebalance_roster_slots(v_trade.proposing_team_id);
    perform public.rebalance_roster_slots(v_trade.receiving_team_id);
    update public.trades set status = 'accepted', responded_at = now() where id = p_trade_id;
    v_new_status := 'accepted';
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'trade.responded', 'trade', p_trade_id::text, jsonb_build_object('status', v_new_status), p_idempotency_key);
  update public.leagues set state_version = state_version + 1 where id = v_trade.league_id
  returning state_version into v_state_version;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'respond_to_trade', p_idempotency_key, jsonb_build_object('trade_id', p_trade_id, 'status', v_new_status, 'state_version', v_state_version));
  return jsonb_build_object('trade_id', p_trade_id, 'status', v_new_status, 'state_version', v_state_version);
end;
$$;

create or replace function public.cancel_trade(p_trade_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_existing jsonb;
  v_state_version bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':trade_cancel:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
  where user_id = v_user_id and command = 'cancel_trade' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trade_id::text || ':respond', 0));
  select * into v_trade from public.trades where id = p_trade_id for update;
  if v_trade.id is null or v_trade.status <> 'proposed' then raise exception 'Trade is no longer open'; end if;
  if not public.owns_fantasy_team(v_trade.proposing_team_id) and not public.current_user_is_admin() then raise exception 'Proposing team owner access required'; end if;
  update public.trades set status = 'cancelled', responded_at = now() where id = p_trade_id;
  update public.leagues set state_version = state_version + 1 where id = v_trade.league_id
  returning state_version into v_state_version;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'cancel_trade', p_idempotency_key, jsonb_build_object('trade_id', p_trade_id, 'status', 'cancelled', 'state_version', v_state_version));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'trade.cancelled', 'trade', p_trade_id::text, jsonb_build_object('status', 'cancelled'), p_idempotency_key);
  return jsonb_build_object('trade_id', p_trade_id, 'status', 'cancelled', 'state_version', v_state_version);
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.drafts;
  alter publication supabase_realtime add table public.draft_picks;
  alter publication supabase_realtime add table public.matchups;
  alter publication supabase_realtime add table public.fantasy_point_events;
  alter publication supabase_realtime add table public.notifications;
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

revoke all on function public.request_waiver(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.process_due_waivers(uuid) from public, anon, authenticated, service_role;
revoke all on function public.propose_trade(uuid, uuid, uuid[], uuid[], timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.rebalance_roster_slots(uuid) from public, anon, authenticated, service_role;
revoke all on function public.respond_to_trade(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.cancel_trade(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.request_waiver(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.process_due_waivers(uuid) to authenticated, service_role;
grant execute on function public.propose_trade(uuid, uuid, uuid[], uuid[], timestamptz, text) to authenticated;
grant execute on function public.respond_to_trade(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_trade(uuid, text) to authenticated;
