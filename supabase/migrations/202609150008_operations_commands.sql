alter table public.sponsors
  add constraint sponsors_https_destination check (destination_url ~ '^https://');
alter table public.sponsor_campaigns
  add constraint sponsor_campaigns_https_creative check (creative_url ~ '^https://');
alter table public.roster_slot_rules
  add constraint starter_slots_are_physical_slots check (not is_starter or slot_count = 1);

create or replace function public.set_draft_status(
  p_draft_id uuid,
  p_action text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_draft public.drafts%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_action not in ('pause', 'resume') then raise exception 'Draft action must be pause or resume'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':draft_status:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
  where user_id = v_user_id and command = 'set_draft_status' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_draft from public.drafts where id = p_draft_id for update;
  if v_draft.id is null or not public.is_league_commissioner(v_draft.league_id) then
    raise exception 'Commissioner access required';
  end if;
  if p_action = 'pause' and v_draft.status = 'active' then
    update public.drafts set status = 'paused', pick_deadline = null, state_version = state_version + 1
    where id = p_draft_id;
  elsif p_action = 'resume' and v_draft.status = 'paused' then
    update public.drafts set status = 'active', pick_deadline = now() + make_interval(secs => pick_seconds), state_version = state_version + 1
    where id = p_draft_id;
  else
    raise exception 'Draft cannot transition from % using %', v_draft.status, p_action;
  end if;
  v_response := jsonb_build_object('draft_id', p_draft_id, 'status', case when p_action = 'pause' then 'paused' else 'active' end);
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'set_draft_status', p_idempotency_key, v_response);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'draft.' || p_action || 'd', 'draft', p_draft_id::text, v_response, p_idempotency_key);
  return v_response;
end;
$$;

create or replace function public.generate_matchup_schedule(
  p_league_id uuid,
  p_starts_at timestamptz,
  p_cycles integer,
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
  v_team_ids uuid[];
  v_rotation uuid[];
  v_team_count integer;
  v_rotation_count integer;
  v_period_days integer;
  v_period integer;
  v_left uuid;
  v_right uuid;
  v_home uuid;
  v_away uuid;
  v_last uuid;
  v_inserted integer := 0;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user_id is null or not public.is_league_commissioner(p_league_id) then raise exception 'Commissioner access required'; end if;
  if p_cycles not between 1 and 10 then raise exception 'Schedule cycles must be 1 to 10'; end if;
  if p_starts_at <= now() - interval '1 day' then raise exception 'Schedule start is too far in the past'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':matchups:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
  where user_id = v_user_id and command = 'generate_matchup_schedule' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_league from public.leagues where id = p_league_id for update;
  if v_league.format <> 'head_to_head' then raise exception 'Matchup schedules apply only to head-to-head leagues'; end if;
  if v_league.status not in ('drafting', 'active') then raise exception 'League must have started before scheduling matchups'; end if;
  if exists (select 1 from public.matchups where league_id = p_league_id) then raise exception 'League already has a matchup schedule'; end if;
  select (matchup_config ->> 'periodDays')::integer into v_period_days
  from public.scoring_rulesets where id = v_league.ruleset_id;
  if v_period_days not between 1 and 31 then raise exception 'Ruleset has an invalid matchup period'; end if;
  select array_agg(id order by draft_position, created_at), count(*)
  into v_team_ids, v_team_count
  from public.fantasy_teams where league_id = p_league_id and owner_id is not null;
  if v_team_count < 2 then raise exception 'A schedule requires at least two teams'; end if;
  v_rotation := v_team_ids;
  if v_team_count % 2 = 1 then v_rotation := array_append(v_rotation, null::uuid); end if;
  v_rotation_count := array_length(v_rotation, 1);

  for v_cycle in 0..p_cycles - 1 loop
    v_rotation := case when v_team_count % 2 = 1 then array_append(v_team_ids, null::uuid) else v_team_ids end;
    for v_round in 0..v_rotation_count - 2 loop
      v_period := v_cycle * (v_rotation_count - 1) + v_round + 1;
      for v_index in 1..v_rotation_count / 2 loop
        v_left := v_rotation[v_index];
        v_right := v_rotation[v_rotation_count - v_index + 1];
        if v_left is not null and v_right is not null then
          if (v_round + v_cycle) % 2 = 0 then v_home := v_left; v_away := v_right;
          else v_home := v_right; v_away := v_left;
          end if;
          insert into public.matchups (league_id, period, starts_at, ends_at, home_team_id, away_team_id)
          values (
            p_league_id,
            v_period,
            p_starts_at + make_interval(days => (v_period - 1) * v_period_days),
            p_starts_at + make_interval(days => v_period * v_period_days),
            v_home,
            v_away
          );
          v_inserted := v_inserted + 1;
        end if;
      end loop;
      v_last := v_rotation[v_rotation_count];
      v_rotation := array_cat(array[v_rotation[1], v_last], v_rotation[2:v_rotation_count - 1]);
    end loop;
  end loop;

  v_response := jsonb_build_object('league_id', p_league_id, 'matchups_created', v_inserted, 'periods', p_cycles * (v_rotation_count - 1));
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'generate_matchup_schedule', p_idempotency_key, v_response);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'matchups.generated', 'league', p_league_id::text, v_response, p_idempotency_key);
  return v_response;
end;
$$;

create or replace function public.advance_matchup_periods(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activated integer := 0;
  v_finalized integer := 0;
begin
  if p_limit not between 1 and 1000 then raise exception 'Invalid processing limit'; end if;
  with candidates as (
    select id from public.matchups
    where status = 'scheduled' and starts_at <= now() and ends_at > now()
    order by starts_at limit p_limit for update skip locked
  )
  update public.matchups m set status = 'active'
  from candidates c where m.id = c.id;
  get diagnostics v_activated = row_count;

  with candidates as (
    select m.id
    from public.matchups m
    join public.leagues l on l.id = m.league_id
    where m.status in ('scheduled', 'active') and m.ends_at <= now()
      and not exists (
        select 1 from public.games g
        where g.competition_id = l.competition_id
          and g.starts_at >= m.starts_at and g.starts_at < m.ends_at
          and g.status not in ('final', 'cancelled', 'postponed')
      )
    order by m.ends_at limit p_limit for update of m skip locked
  )
  update public.matchups m set status = 'final', finalized_at = now()
  from candidates c where m.id = c.id;
  get diagnostics v_finalized = row_count;
  return jsonb_build_object('activated', v_activated, 'finalized', v_finalized);
end;
$$;

create or replace function public.expire_trades(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_expired integer := 0;
begin
  if p_limit not between 1 and 1000 then raise exception 'Invalid processing limit'; end if;
  with candidates as (
    select id from public.trades
    where status = 'proposed' and expires_at <= now()
    order by expires_at limit p_limit for update skip locked
  )
  update public.trades t set status = 'expired', responded_at = now()
  from candidates c where t.id = c.id;
  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

create or replace function public.moderate_chat_message(
  p_message_id uuid,
  p_hide boolean,
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
  v_league_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user_id is null or char_length(trim(p_reason)) < 8 then raise exception 'Moderator and reason are required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':moderate_chat:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
  where user_id = v_user_id and command = 'moderate_chat_message' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select league_id into v_league_id from public.chat_messages where id = p_message_id for update;
  if v_league_id is null or (not public.is_league_commissioner(v_league_id) and not public.current_user_is_admin()) then
    raise exception 'Commissioner or administrator access required';
  end if;
  update public.chat_messages set hidden_at = case when p_hide then now() else null end,
    hidden_by = case when p_hide then v_user_id else null end where id = p_message_id;
  v_response := jsonb_build_object('message_id', p_message_id, 'hidden', p_hide);
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'moderate_chat_message', p_idempotency_key, v_response);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'chat.moderated', 'chat_message', p_message_id::text, jsonb_build_object('hidden', p_hide, 'reason', trim(p_reason)), p_idempotency_key);
  return v_response;
end;
$$;

create or replace function public.record_sponsor_event(p_campaign_id uuid, p_event_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_type not in ('impression', 'click') then raise exception 'Invalid sponsor event'; end if;
  if not exists (
    select 1 from public.sponsor_campaigns
    where id = p_campaign_id and status = 'active' and now() between starts_at and ends_at
  ) then raise exception 'Sponsor campaign is not active'; end if;
  insert into public.sponsor_events (campaign_id, event_type, occurred_on, count)
  values (p_campaign_id, p_event_type, current_date, 1)
  on conflict (campaign_id, event_type, occurred_on)
  do update set count = public.sponsor_events.count + 1;
end;
$$;

revoke all on function public.set_draft_status(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.generate_matchup_schedule(uuid, timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.advance_matchup_periods(integer) from public, anon, authenticated, service_role;
revoke all on function public.expire_trades(integer) from public, anon, authenticated, service_role;
revoke all on function public.moderate_chat_message(uuid, boolean, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_sponsor_event(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_draft_status(uuid, text, text) to authenticated;
grant execute on function public.generate_matchup_schedule(uuid, timestamptz, integer, text) to authenticated;
grant execute on function public.advance_matchup_periods(integer) to service_role;
grant execute on function public.expire_trades(integer) to service_role;
grant execute on function public.moderate_chat_message(uuid, boolean, text, text) to authenticated;
grant execute on function public.record_sponsor_event(uuid, text) to anon, authenticated;
