create or replace function public.create_league(
  p_name text,
  p_competition_id uuid,
  p_format public.league_format,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ruleset_id uuid;
  v_league_id uuid;
  v_existing jsonb;
  v_invite_code text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(trim(p_name)) not between 3 and 60 then raise exception 'League name must be 3 to 60 characters'; end if;
  if char_length(p_idempotency_key) not between 8 and 200 then raise exception 'Invalid idempotency key'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':create_league:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
    where user_id = v_user_id and command = 'create_league' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select c.ruleset_id into v_ruleset_id
  from public.competitions c
  join public.scoring_rulesets r on r.id = c.ruleset_id
  where c.id = p_competition_id and c.is_active and r.status = 'approved';
  if v_ruleset_id is null then raise exception 'Competition does not have an active approved ruleset'; end if;

  v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.leagues (competition_id, commissioner_id, ruleset_id, name, format, invite_code)
  values (p_competition_id, v_user_id, v_ruleset_id, trim(p_name), p_format, v_invite_code)
  returning id into v_league_id;

  insert into public.league_members (league_id, user_id, role)
  values (v_league_id, v_user_id, 'commissioner');
  insert into public.fantasy_teams (league_id, owner_id, name, draft_position, waiver_priority)
  values (v_league_id, v_user_id, trim(p_name) || ' Team', 1, 1);

  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'create_league', p_idempotency_key, jsonb_build_object('league_id', v_league_id, 'state_version', 1));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'league.created', 'league', v_league_id::text, jsonb_build_object('format', p_format), p_idempotency_key);
  return jsonb_build_object('league_id', v_league_id, 'state_version', 1);
end;
$$;

create or replace function public.join_league(
  p_invite_code text,
  p_team_name text,
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
  v_team_id uuid;
  v_count integer;
  v_state_version bigint;
  v_existing jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if char_length(trim(p_team_name)) not between 3 and 60 then raise exception 'Team name must be 3 to 60 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':join_league:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
    where user_id = v_user_id and command = 'join_league' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_league from public.leagues where invite_code = trim(p_invite_code) for update;
  if v_league.id is null then raise exception 'Invite code not found'; end if;
  if v_league.status <> 'setup' then raise exception 'League membership is closed'; end if;
  if exists (select 1 from public.league_members where league_id = v_league.id and user_id = v_user_id) then
    raise exception 'Already a member of this league';
  end if;
  select count(*) into v_count from public.league_members where league_id = v_league.id;
  if v_count >= v_league.max_members then raise exception 'League is full'; end if;

  insert into public.league_members (league_id, user_id) values (v_league.id, v_user_id);
  insert into public.fantasy_teams (league_id, owner_id, name, draft_position, waiver_priority)
  values (v_league.id, v_user_id, trim(p_team_name), v_count + 1, v_count + 1)
  returning id into v_team_id;
  update public.leagues set state_version = state_version + 1 where id = v_league.id returning state_version into v_state_version;

  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'join_league', p_idempotency_key, jsonb_build_object('fantasy_team_id', v_team_id, 'league_id', v_league.id, 'state_version', v_state_version));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, request_id)
  values (v_user_id, 'league.joined', 'league', v_league.id::text, p_idempotency_key);
  return jsonb_build_object('fantasy_team_id', v_team_id, 'league_id', v_league.id, 'state_version', v_state_version);
end;
$$;

create or replace function public.start_draft(
  p_league_id uuid,
  p_rounds integer,
  p_pick_seconds integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_draft_id uuid;
  v_team_order uuid[];
  v_team_count integer;
  v_ruleset_rounds integer;
  v_ruleset_pick_seconds integer;
  v_existing jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_league_commissioner(p_league_id) then raise exception 'Commissioner access required'; end if;
  if p_rounds < 1 or p_pick_seconds not between 15 and 86400 then raise exception 'Invalid draft configuration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_league_id::text || ':start_draft', 0));
  select response into v_existing from public.idempotency_keys
    where user_id = v_user_id and command = 'start_draft' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select count(*), array_agg(id order by draft_position, created_at)
  into v_team_count, v_team_order
  from public.fantasy_teams where league_id = p_league_id and owner_id is not null;
  if v_team_count < 2 then raise exception 'A draft requires at least two teams'; end if;
  if exists (select 1 from public.drafts where league_id = p_league_id) then raise exception 'Draft already exists'; end if;
  select sum(sr.slot_count), (r.draft_config ->> 'pickSeconds')::integer
  into v_ruleset_rounds, v_ruleset_pick_seconds
  from public.leagues l
  join public.scoring_rulesets r on r.id = l.ruleset_id
  join public.roster_slot_rules sr on sr.ruleset_id = r.id
  where l.id = p_league_id and r.status = 'approved'
  group by r.draft_config;
  if v_ruleset_rounds is null or v_ruleset_pick_seconds is null then
    raise exception 'Approved ruleset has incomplete draft configuration';
  end if;
  if p_rounds <> v_ruleset_rounds or p_pick_seconds <> v_ruleset_pick_seconds then
    raise exception 'Draft configuration must match the league ruleset';
  end if;

  insert into public.drafts (league_id, status, rounds, pick_seconds, team_order, pick_deadline, starts_at)
  values (p_league_id, 'active', v_ruleset_rounds, v_ruleset_pick_seconds, v_team_order, now() + make_interval(secs => v_ruleset_pick_seconds), now())
  returning id into v_draft_id;
  update public.leagues set status = 'drafting', state_version = state_version + 1 where id = p_league_id and status = 'setup';
  if not found then raise exception 'League is not ready to draft'; end if;
  insert into public.notifications (user_id, kind, title, body, data)
  select owner_id, 'draft_started', 'Your draft has started', 'You are on the clock for the first pick.', jsonb_build_object('draft_id', v_draft_id)
  from public.fantasy_teams where id = v_team_order[1] and owner_id is not null;

  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'start_draft', p_idempotency_key, jsonb_build_object('draft_id', v_draft_id, 'state_version', 1, 'status', 'active'));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, request_id)
  values (v_user_id, 'draft.started', 'draft', v_draft_id::text, p_idempotency_key);
  return jsonb_build_object('draft_id', v_draft_id, 'state_version', 1, 'status', 'active');
end;
$$;

create or replace function public.make_draft_pick(
  p_draft_id uuid,
  p_athlete_id uuid,
  p_idempotency_key text,
  p_source public.draft_pick_source default 'manager'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_draft public.drafts%rowtype;
  v_team_count integer;
  v_round integer;
  v_pick_in_round integer;
  v_expected_team uuid;
  v_league public.leagues%rowtype;
  v_slot_code text;
  v_roster_status public.roster_status;
  v_pick_id uuid;
  v_existing jsonb;
  v_response jsonb;
  v_committed_source public.draft_pick_source := 'manager'::public.draft_pick_source;
  v_state_version bigint;
  v_committed_status public.draft_status;
  v_next_overall_pick integer;
  v_next_round integer;
  v_next_pick_in_round integer;
  v_next_team uuid;
begin
  if v_user_id is null
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    and session_user <> 'postgres' then
    raise exception 'Authentication required';
  end if;
  if v_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':draft_pick:' || p_idempotency_key, 0));
    select response into v_existing from public.idempotency_keys
      where user_id = v_user_id and command = 'draft_pick' and idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;

  select * into v_draft from public.drafts where id = p_draft_id for update;
  if v_draft.id is null or v_draft.status <> 'active' then raise exception 'Draft is not active'; end if;
  select * into v_league from public.leagues where id = v_draft.league_id for update;
  v_team_count := coalesce(array_length(v_draft.team_order, 1), 0);
  if v_team_count < 2 then raise exception 'Draft order is invalid'; end if;
  v_round := ((v_draft.current_overall_pick - 1) / v_team_count) + 1;
  v_pick_in_round := ((v_draft.current_overall_pick - 1) % v_team_count) + 1;
  if v_round % 2 = 0 then
    v_expected_team := v_draft.team_order[v_team_count - v_pick_in_round + 1];
  else
    v_expected_team := v_draft.team_order[v_pick_in_round];
  end if;

  if not (public.current_user_is_admin() or session_user = 'postgres') and not exists (
    select 1 from public.fantasy_teams where id = v_expected_team and owner_id = v_user_id
  ) then raise exception 'It is not your turn'; end if;
  if (public.current_user_is_admin() or session_user = 'postgres') and p_source in ('autopick', 'commissioner') then
    v_committed_source := p_source;
  end if;
  if not exists (
    select 1 from public.athletes a
    where a.id = p_athlete_id and a.competition_id = v_league.competition_id and a.status = 'active'
  ) then raise exception 'Athlete is not eligible for this draft'; end if;

  select sr.slot_code, case when sr.is_starter then 'starter'::public.roster_status else 'bench'::public.roster_status end
  into v_slot_code, v_roster_status
  from public.roster_slot_rules sr
  join public.athletes a on a.id = p_athlete_id
  where sr.ruleset_id = v_league.ruleset_id
    and a.position = any(sr.allowed_positions)
    and (
      select count(*) from public.roster_entries re
      where re.fantasy_team_id = v_expected_team and re.slot_code = sr.slot_code and re.released_at is null
    ) < sr.slot_count
  order by sr.is_starter desc, sr.id
  limit 1;
  if v_slot_code is null then raise exception 'Athlete does not fit an available roster slot'; end if;

  insert into public.draft_picks (draft_id, fantasy_team_id, athlete_id, overall_pick, round, pick_in_round, source)
  values (p_draft_id, v_expected_team, p_athlete_id, v_draft.current_overall_pick, v_round, v_pick_in_round, v_committed_source)
  returning id into v_pick_id;
  insert into public.roster_entries (league_id, fantasy_team_id, athlete_id, slot_code, status, acquisition_type)
  values (v_draft.league_id, v_expected_team, p_athlete_id, v_slot_code, v_roster_status, 'draft');
  insert into public.roster_transactions (league_id, fantasy_team_id, transaction_type, athlete_in_id, initiated_by)
  values (v_draft.league_id, v_expected_team, 'draft', p_athlete_id, v_user_id);

  if v_draft.current_overall_pick >= v_team_count * v_draft.rounds then
    update public.drafts set status = 'complete', current_overall_pick = current_overall_pick + 1,
      state_version = state_version + 1, pick_deadline = null, completed_at = now() where id = p_draft_id;
    update public.leagues set status = 'active', state_version = state_version + 1 where id = v_draft.league_id;
  else
    update public.drafts set current_overall_pick = current_overall_pick + 1,
      state_version = state_version + 1, pick_deadline = now() + make_interval(secs => pick_seconds) where id = p_draft_id;
  end if;

  select state_version, status, current_overall_pick into v_state_version, v_committed_status, v_next_overall_pick
  from public.drafts where id = p_draft_id;
  if v_committed_status = 'active' then
    v_next_round := ((v_next_overall_pick - 1) / v_team_count) + 1;
    v_next_pick_in_round := ((v_next_overall_pick - 1) % v_team_count) + 1;
    if v_next_round % 2 = 0 then v_next_team := v_draft.team_order[v_team_count - v_next_pick_in_round + 1];
    else v_next_team := v_draft.team_order[v_next_pick_in_round];
    end if;
    insert into public.notifications (user_id, kind, title, body, data)
    select owner_id, 'draft_clock', 'You are on the clock', 'Make your pick before the server autopick deadline.', jsonb_build_object('draft_id', p_draft_id, 'overall_pick', v_next_overall_pick)
    from public.fantasy_teams where id = v_next_team and owner_id is not null;
  end if;

  v_response := jsonb_build_object(
    'pick_id', v_pick_id,
    'overall_pick', v_draft.current_overall_pick,
    'fantasy_team_id', v_expected_team,
    'athlete_id', p_athlete_id,
    'source', v_committed_source,
    'state_version', v_state_version,
    'status', v_committed_status
  );
  if v_user_id is not null then
    insert into public.idempotency_keys (user_id, command, idempotency_key, response)
    values (v_user_id, 'draft_pick', p_idempotency_key, v_response);
  end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'draft.pick_committed', 'draft_pick', v_pick_id::text, v_response, p_idempotency_key);
  return v_response;
exception
  when unique_violation then
    raise exception 'Athlete or pick was already committed; refresh draft state' using errcode = '23505';
end;
$$;

create or replace function public.set_lineup(
  p_fantasy_team_id uuid,
  p_game_id uuid,
  p_entries jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_league_id uuid;
  v_game_start timestamptz;
  v_existing jsonb;
  v_count integer;
  v_state_version bigint;
begin
  if v_user_id is null or not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_fantasy_team_id::text || ':' || p_game_id::text, 0));
  select response into v_existing from public.idempotency_keys
    where user_id = v_user_id and command = 'set_lineup' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select ft.league_id, g.starts_at into v_league_id, v_game_start
  from public.fantasy_teams ft
  join public.leagues l on l.id = ft.league_id
  join public.games g on g.id = p_game_id and g.competition_id = l.competition_id
  where ft.id = p_fantasy_team_id;
  if v_league_id is null then raise exception 'Team and game do not share a competition'; end if;
  if now() >= v_game_start then raise exception 'Lineup is locked for this game'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then raise exception 'Lineup entries are required'; end if;

  select count(*) into v_count
  from jsonb_to_recordset(p_entries) as e(athlete_id uuid, slot_code text)
  join public.roster_entries r on r.fantasy_team_id = p_fantasy_team_id and r.athlete_id = e.athlete_id and r.released_at is null
  join public.leagues l on l.id = v_league_id
  join public.roster_slot_rules sr on sr.ruleset_id = l.ruleset_id and sr.slot_code = e.slot_code and sr.is_starter
  join public.athletes a on a.id = e.athlete_id and a.position = any(sr.allowed_positions);
  if v_count <> jsonb_array_length(p_entries) then raise exception 'Lineup contains an ineligible athlete or slot'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_entries) as e(athlete_id uuid, slot_code text)
    group by slot_code having count(*) > 1
  ) then raise exception 'A lineup slot may be filled only once'; end if;

  delete from public.lineup_entries where fantasy_team_id = p_fantasy_team_id and game_id = p_game_id;
  insert into public.lineup_entries (league_id, fantasy_team_id, game_id, athlete_id, slot_code, locked_at)
  select v_league_id, p_fantasy_team_id, p_game_id, e.athlete_id, e.slot_code, v_game_start
  from jsonb_to_recordset(p_entries) as e(athlete_id uuid, slot_code text);
  update public.leagues set state_version = state_version + 1 where id = v_league_id
  returning state_version into v_state_version;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'set_lineup', p_idempotency_key, jsonb_build_object('entry_count', v_count, 'state_version', v_state_version));
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'lineup.updated', 'fantasy_team', p_fantasy_team_id::text, p_entries, p_idempotency_key);
  return jsonb_build_object('entry_count', v_count, 'state_version', v_state_version);
end;
$$;

create or replace function public.add_free_agent(
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
  v_slot_code text;
  v_roster_status public.roster_status;
  v_existing jsonb;
  v_transaction_id uuid;
  v_roster_count integer;
  v_roster_max integer;
  v_state_version bigint;
begin
  if v_user_id is null or not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':add_free_agent:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys where user_id = v_user_id and command = 'add_free_agent' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select l.* into v_league from public.leagues l join public.fantasy_teams ft on ft.league_id = l.id where ft.id = p_fantasy_team_id for update;
  if v_league.status <> 'active' then raise exception 'League is not active'; end if;
  if not coalesce((select (transaction_config ->> 'freeAgentsEnabled')::boolean from public.scoring_rulesets where id = v_league.ruleset_id), false) then
    raise exception 'Free agents are disabled';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_league.id::text || ':' || p_athlete_in_id::text, 0));
  if not exists (select 1 from public.athletes where id = p_athlete_in_id and competition_id = v_league.competition_id and status = 'active') then raise exception 'Athlete is not eligible'; end if;
  if exists (select 1 from public.roster_entries where league_id = v_league.id and athlete_id = p_athlete_in_id and released_at is null) then raise exception 'Athlete is already rostered'; end if;

  select count(*) into v_roster_count from public.roster_entries where fantasy_team_id = p_fantasy_team_id and released_at is null;
  select coalesce(sum(slot_count), 0) into v_roster_max from public.roster_slot_rules where ruleset_id = v_league.ruleset_id;
  if p_athlete_out_id is null and v_roster_count >= v_roster_max then raise exception 'Roster is full; choose an athlete to drop'; end if;
  if p_athlete_out_id is not null then
    if exists (
      select 1 from public.lineup_entries le
      join public.games g on g.id = le.game_id
      where le.fantasy_team_id = p_fantasy_team_id
        and le.athlete_id = p_athlete_out_id
        and g.starts_at <= now()
        and g.status not in ('final', 'cancelled', 'postponed')
    ) then raise exception 'Dropped athlete is locked in an active game'; end if;
    update public.roster_entries set released_at = now() where fantasy_team_id = p_fantasy_team_id and athlete_id = p_athlete_out_id and released_at is null;
    if not found then raise exception 'Dropped athlete is not on this roster'; end if;
  end if;
  select sr.slot_code, case when sr.is_starter then 'starter'::public.roster_status else 'bench'::public.roster_status end
  into v_slot_code, v_roster_status
  from public.roster_slot_rules sr
  join public.athletes a on a.id = p_athlete_in_id
  where sr.ruleset_id = v_league.ruleset_id
    and a.position = any(sr.allowed_positions)
    and (
      select count(*) from public.roster_entries re
      where re.fantasy_team_id = p_fantasy_team_id and re.slot_code = sr.slot_code and re.released_at is null
    ) < sr.slot_count
  order by sr.is_starter desc, sr.id
  limit 1;
  if v_slot_code is null then raise exception 'Athlete does not fit an available roster slot'; end if;
  insert into public.roster_entries (league_id, fantasy_team_id, athlete_id, slot_code, status, acquisition_type)
  values (v_league.id, p_fantasy_team_id, p_athlete_in_id, v_slot_code, v_roster_status, 'add');
  insert into public.roster_transactions (league_id, fantasy_team_id, transaction_type, athlete_in_id, athlete_out_id, initiated_by)
  values (v_league.id, p_fantasy_team_id, 'add', p_athlete_in_id, p_athlete_out_id, v_user_id) returning id into v_transaction_id;
  update public.leagues set state_version = state_version + 1 where id = v_league.id
  returning state_version into v_state_version;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'add_free_agent', p_idempotency_key, jsonb_build_object('transaction_id', v_transaction_id, 'state_version', v_state_version));
  return jsonb_build_object('transaction_id', v_transaction_id, 'state_version', v_state_version);
end;
$$;

create or replace function public.post_chat_message(p_league_id uuid, p_body text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_message_id uuid;
  v_existing jsonb;
begin
  if v_user_id is null or not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if char_length(trim(p_body)) not between 1 and 500 then raise exception 'Message must be 1 to 500 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':chat', 0));
  select response into v_existing from public.idempotency_keys where user_id = v_user_id and command = 'post_chat' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return (v_existing ->> 'message_id')::uuid; end if;
  if (select count(*) from public.chat_messages where author_id = v_user_id and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Message rate limit exceeded';
  end if;
  insert into public.chat_messages (league_id, author_id, body) values (p_league_id, v_user_id, trim(p_body)) returning id into v_message_id;
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'post_chat', p_idempotency_key, jsonb_build_object('message_id', v_message_id));
  return v_message_id;
end;
$$;

create or replace function public.mute_chat_user(p_league_id uuid, p_muted_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists (select 1 from public.league_members where league_id = p_league_id and user_id = p_muted_user_id) then raise exception 'User is not a league member'; end if;
  insert into public.chat_mutes (league_id, user_id, muted_user_id) values (p_league_id, auth.uid(), p_muted_user_id) on conflict do nothing;
end;
$$;

create or replace function public.report_chat_message(p_message_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_report_id uuid;
begin
  select league_id into v_league_id from public.chat_messages where id = p_message_id;
  if auth.uid() is null or not public.is_league_member(v_league_id) then raise exception 'League membership required'; end if;
  insert into public.chat_reports (message_id, reporter_id, reason) values (p_message_id, auth.uid(), trim(p_reason)) returning id into v_report_id;
  return v_report_id;
end;
$$;

create or replace function public.replay_game(p_game_id uuid, p_source_identity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator or service access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':replay', 0));

  insert into public.fantasy_point_events (
    league_id, fantasy_team_id, athlete_id, game_id, ruleset_id, stat_key,
    stat_value, points, kind, source_identity
  )
  select target.league_id, target.fantasy_team_id, target.athlete_id, p_game_id,
    target.ruleset_id, target.stat_key, target.stat_value,
    target.target_points - target.current_points,
    case when target.current_points = 0 then 'score'::public.point_event_kind else 'correction'::public.point_event_kind end,
    p_source_identity
  from (
    select le.league_id, le.fantasy_team_id, n.athlete_id, l.ruleset_id, sr.stat_key,
      coalesce((n.stats ->> sr.stat_key)::numeric, 0) as stat_value,
      round(coalesce((n.stats ->> sr.stat_key)::numeric, 0) * sr.points, 3) as target_points,
      coalesce((
        select sum(pe.points) from public.fantasy_point_events pe
        where pe.fantasy_team_id = le.fantasy_team_id and pe.athlete_id = n.athlete_id
          and pe.game_id = p_game_id and pe.stat_key = sr.stat_key and pe.kind in ('score', 'correction')
      ), 0) as current_points
    from public.normalized_player_game_stats n
    join public.lineup_entries le on le.game_id = n.game_id and le.athlete_id = n.athlete_id
    join public.leagues l on l.id = le.league_id
    join public.scoring_rules sr on sr.ruleset_id = l.ruleset_id
    where n.game_id = p_game_id
  ) target
  where target.target_points <> target.current_points
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  update public.matchups m set
    home_points = coalesce((
      select sum(pe.points) from public.fantasy_point_events pe
      join public.games g on g.id = pe.game_id
      where pe.fantasy_team_id = m.home_team_id and g.starts_at >= m.starts_at and g.starts_at < m.ends_at
    ), 0),
    away_points = coalesce((
      select sum(pe.points) from public.fantasy_point_events pe
      join public.games g on g.id = pe.game_id
      where pe.fantasy_team_id = m.away_team_id and g.starts_at >= m.starts_at and g.starts_at < m.ends_at
    ), 0)
  where m.league_id in (
    select distinct league_id from public.lineup_entries where game_id = p_game_id
  );
  update public.provider_snapshots set processed_at = now() where game_id = p_game_id and source_identity = p_source_identity;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state)
  values (auth.uid(), 'scoring.game_replayed', 'game', p_game_id::text, jsonb_build_object('source_identity', p_source_identity, 'events_inserted', v_inserted));
  return jsonb_build_object('events_inserted', v_inserted);
end;
$$;

create or replace function public.admin_adjust_score(
  p_fantasy_team_id uuid,
  p_athlete_id uuid,
  p_game_id uuid,
  p_points numeric,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_league_id uuid;
  v_ruleset_id uuid;
  v_state_version bigint;
  v_existing jsonb;
  v_response jsonb;
begin
  if not public.current_user_is_admin() then raise exception 'Administrator access required'; end if;
  if char_length(trim(p_reason)) < 8 or p_points = 0 then raise exception 'A reason and non-zero adjustment are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':score_adjustment:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
  where user_id = v_user_id and command = 'admin_adjust_score' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select ft.league_id, l.ruleset_id into v_league_id, v_ruleset_id
  from public.fantasy_teams ft
  join public.leagues l on l.id = ft.league_id
  join public.games g on g.id = p_game_id and g.competition_id = l.competition_id
  join public.athletes a on a.id = p_athlete_id and a.competition_id = l.competition_id
  join public.lineup_entries le on le.game_id = g.id and le.fantasy_team_id = ft.id and le.athlete_id = a.id
  where ft.id = p_fantasy_team_id;
  if v_league_id is null then raise exception 'Adjustment target is not an eligible lineup entry'; end if;
  insert into public.fantasy_point_events (league_id, fantasy_team_id, athlete_id, game_id, ruleset_id, stat_key, stat_value, points, kind, source_identity, created_by, reason)
  values (v_league_id, p_fantasy_team_id, p_athlete_id, p_game_id, v_ruleset_id, 'admin_adjustment', 0, p_points, 'admin_adjustment', p_idempotency_key, v_user_id, trim(p_reason))
  returning id into v_event_id;
  update public.matchups m set
    home_points = coalesce((select sum(pe.points) from public.fantasy_point_events pe join public.games g on g.id = pe.game_id where pe.fantasy_team_id = m.home_team_id and g.starts_at >= m.starts_at and g.starts_at < m.ends_at), 0),
    away_points = coalesce((select sum(pe.points) from public.fantasy_point_events pe join public.games g on g.id = pe.game_id where pe.fantasy_team_id = m.away_team_id and g.starts_at >= m.starts_at and g.starts_at < m.ends_at), 0)
  where m.league_id = v_league_id
    and exists (select 1 from public.games g where g.id = p_game_id and g.starts_at >= m.starts_at and g.starts_at < m.ends_at);
  update public.leagues set state_version = state_version + 1 where id = v_league_id
  returning state_version into v_state_version;
  v_response := jsonb_build_object('event_id', v_event_id, 'state_version', v_state_version);
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'admin_adjust_score', p_idempotency_key, v_response);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'scoring.admin_adjustment', 'fantasy_point_event', v_event_id::text, jsonb_build_object('points', p_points, 'reason', trim(p_reason)), p_idempotency_key);
  return v_response;
end;
$$;

revoke all on function public.create_league(text, uuid, public.league_format, text) from public, anon, authenticated, service_role;
revoke all on function public.join_league(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.start_draft(uuid, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.make_draft_pick(uuid, uuid, text, public.draft_pick_source) from public, anon, authenticated, service_role;
revoke all on function public.set_lineup(uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.add_free_agent(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.post_chat_message(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mute_chat_user(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.report_chat_message(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.replay_game(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_adjust_score(uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated, service_role;

grant execute on function public.create_league(text, uuid, public.league_format, text) to authenticated;
grant execute on function public.join_league(text, text, text) to authenticated;
grant execute on function public.start_draft(uuid, integer, integer, text) to authenticated;
grant execute on function public.make_draft_pick(uuid, uuid, text, public.draft_pick_source) to authenticated, service_role;
grant execute on function public.set_lineup(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.add_free_agent(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.post_chat_message(uuid, text, text) to authenticated;
grant execute on function public.mute_chat_user(uuid, uuid) to authenticated;
grant execute on function public.report_chat_message(uuid, text) to authenticated;
grant execute on function public.replay_game(uuid, text) to authenticated, service_role;
grant execute on function public.admin_adjust_score(uuid, uuid, uuid, numeric, text, text) to authenticated;
