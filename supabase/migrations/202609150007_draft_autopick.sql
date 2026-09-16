create table public.athlete_rankings (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  rank integer not null check (rank > 0),
  updated_at timestamptz not null default now(),
  primary key (competition_id, athlete_id),
  unique (competition_id, rank)
);

create table public.draft_queues (
  draft_id uuid not null references public.drafts(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  priority integer not null check (priority > 0),
  created_at timestamptz not null default now(),
  primary key (draft_id, fantasy_team_id, athlete_id),
  unique (draft_id, fantasy_team_id, priority)
);

alter table public.athlete_rankings enable row level security;
alter table public.draft_queues enable row level security;

create policy athlete_rankings_active_read on public.athlete_rankings
  for select to authenticated using (
    exists (
      select 1 from public.competitions c
      where c.id = competition_id and c.is_active
    ) or public.current_user_is_admin()
  );
create policy athlete_rankings_admin_write on public.athlete_rankings
  for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy draft_queues_owner_read on public.draft_queues
  for select to authenticated using (public.owns_fantasy_team(fantasy_team_id));

create or replace function public.set_draft_queue(
  p_draft_id uuid,
  p_athlete_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
  v_competition_id uuid;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(p_idempotency_key) not between 8 and 200 then raise exception 'Invalid idempotency key'; end if;
  if coalesce(array_length(p_athlete_ids, 1), 0) > 500 then raise exception 'Draft queue is too large'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':draft_queue:' || p_idempotency_key, 0));
  select response into v_existing from public.idempotency_keys
    where user_id = v_user_id and command = 'set_draft_queue' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select ft.id, l.competition_id into v_team_id, v_competition_id
  from public.drafts d
  join public.leagues l on l.id = d.league_id
  join public.fantasy_teams ft on ft.league_id = l.id and ft.owner_id = v_user_id
  where d.id = p_draft_id and d.status in ('scheduled', 'active', 'paused');
  if v_team_id is null then raise exception 'Draft team owner access required'; end if;
  if cardinality(p_athlete_ids) <> (
    select count(distinct queued.athlete_id)
    from unnest(p_athlete_ids) as queued(athlete_id)
  ) then
    raise exception 'Draft queue contains duplicate athletes';
  end if;
  if exists (
    select 1 from unnest(p_athlete_ids) athlete_id
    where not exists (
      select 1 from public.athletes a
      where a.id = athlete_id and a.competition_id = v_competition_id and a.status = 'active'
    )
  ) then raise exception 'Draft queue contains an ineligible athlete'; end if;

  delete from public.draft_queues where draft_id = p_draft_id and fantasy_team_id = v_team_id;
  insert into public.draft_queues (draft_id, fantasy_team_id, athlete_id, priority)
  select p_draft_id, v_team_id, athlete_id, ordinal::integer
  from unnest(p_athlete_ids) with ordinality as queued(athlete_id, ordinal);

  v_response := jsonb_build_object('draft_id', p_draft_id, 'fantasy_team_id', v_team_id, 'queued', cardinality(p_athlete_ids));
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'set_draft_queue', p_idempotency_key, v_response);
  insert into public.audit_log (actor_id, action, entity_type, entity_id, after_state, request_id)
  values (v_user_id, 'draft.queue_replaced', 'draft', p_draft_id::text, jsonb_build_object('queued', cardinality(p_athlete_ids)), p_idempotency_key);
  return v_response;
end;
$$;

create or replace function public.process_expired_drafts(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.drafts%rowtype;
  v_league public.leagues%rowtype;
  v_team_count integer;
  v_round integer;
  v_pick_in_round integer;
  v_expected_team uuid;
  v_athlete_id uuid;
  v_processed integer := 0;
  v_paused integer := 0;
begin
  if p_limit not between 1 and 100 then raise exception 'Invalid processing limit'; end if;

  for v_draft in
    select * from public.drafts
    where status = 'active' and pick_deadline <= now()
    order by pick_deadline, id
    limit p_limit
    for update skip locked
  loop
    select * into v_league from public.leagues where id = v_draft.league_id;
    v_team_count := coalesce(array_length(v_draft.team_order, 1), 0);
    v_round := ((v_draft.current_overall_pick - 1) / v_team_count) + 1;
    v_pick_in_round := ((v_draft.current_overall_pick - 1) % v_team_count) + 1;
    if v_round % 2 = 0 then
      v_expected_team := v_draft.team_order[v_team_count - v_pick_in_round + 1];
    else
      v_expected_team := v_draft.team_order[v_pick_in_round];
    end if;

    select candidate.athlete_id into v_athlete_id
    from (
      select q.athlete_id, 0 as source_order, q.priority as selection_order
      from public.draft_queues q
      join public.athletes a on a.id = q.athlete_id
      where q.draft_id = v_draft.id
        and q.fantasy_team_id = v_expected_team
        and a.competition_id = v_league.competition_id
        and a.status = 'active'
        and not exists (
          select 1 from public.draft_picks dp
          where dp.draft_id = v_draft.id and dp.athlete_id = q.athlete_id
        )
        and exists (
          select 1 from public.roster_slot_rules sr
          where sr.ruleset_id = v_league.ruleset_id
            and a.position = any(sr.allowed_positions)
            and (
              select count(*) from public.roster_entries re
              where re.fantasy_team_id = v_expected_team
                and re.slot_code = sr.slot_code
                and re.released_at is null
            ) < sr.slot_count
        )
      union all
      select r.athlete_id, 1, r.rank
      from public.athlete_rankings r
      join public.athletes a on a.id = r.athlete_id
      where r.competition_id = v_league.competition_id
        and a.status = 'active'
        and not exists (
          select 1 from public.draft_picks dp
          where dp.draft_id = v_draft.id and dp.athlete_id = r.athlete_id
        )
        and exists (
          select 1 from public.roster_slot_rules sr
          where sr.ruleset_id = v_league.ruleset_id
            and a.position = any(sr.allowed_positions)
            and (
              select count(*) from public.roster_entries re
              where re.fantasy_team_id = v_expected_team
                and re.slot_code = sr.slot_code
                and re.released_at is null
            ) < sr.slot_count
        )
    ) candidate
    order by candidate.source_order, candidate.selection_order, candidate.athlete_id
    limit 1;

    if v_athlete_id is null then
      update public.drafts set status = 'paused', pick_deadline = null, state_version = state_version + 1
      where id = v_draft.id;
      insert into public.audit_log (action, entity_type, entity_id, after_state)
      values ('draft.autopick_paused', 'draft', v_draft.id::text, jsonb_build_object('reason', 'no_ranked_eligible_athlete'));
      v_paused := v_paused + 1;
      continue;
    end if;

    perform public.make_draft_pick(
      v_draft.id,
      v_athlete_id,
      'autopick:' || v_draft.id::text || ':' || v_draft.current_overall_pick::text,
      'autopick'
    );
    delete from public.draft_queues
    where draft_id = v_draft.id and athlete_id = v_athlete_id;
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('processed', v_processed, 'paused', v_paused);
end;
$$;

revoke all on function public.set_draft_queue(uuid, uuid[], text) from public, anon, authenticated, service_role;
revoke all on function public.process_expired_drafts(integer) from public, anon, authenticated, service_role;
grant execute on function public.set_draft_queue(uuid, uuid[], text) to authenticated;
grant execute on function public.process_expired_drafts(integer) to service_role;

-- Hosted environments should schedule this after migrations:
-- select cron.schedule('draft-autopick', '10 seconds', $$select public.process_expired_drafts(25);$$);
-- It remains explicit so local/staging/production jobs can be independently verified and paused.
