-- First match every mandatory athlete, including the proposed pick. Filling all
-- slots greedily can omit a mandatory athlete even when a legal allocation exists.
create function beta_private.match_owned_athlete(
  candidate jsonb, candidates jsonb, slots jsonb, owners jsonb, seen integer[]
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  slot_record record;
  previous_id text;
  previous_candidate jsonb;
  result jsonb;
  visited integer[] := seen;
begin
  for slot_record in select value s, (ordinality - 1)::integer idx
    from jsonb_array_elements(slots) with ordinality loop
    if slot_record.idx = any(visited)
      or candidate->>'owner' <> slot_record.s->>'team'
      or not exists(select 1 from jsonb_array_elements_text(candidate->'positions') p
        where slot_record.s->'positions' ? p) then continue; end if;
    visited := array_append(visited, slot_record.idx);
    select key into previous_id from jsonb_each_text(owners)
      where value::integer = slot_record.idx;
    if previous_id is null then
      return owners || jsonb_build_object(candidate->>'id', slot_record.idx);
    end if;
    select value into previous_candidate from jsonb_array_elements(candidates)
      where value->>'id' = previous_id;
    result := beta_private.match_owned_athlete(previous_candidate, candidates, slots, owners, visited);
    if result is not null then
      return result || jsonb_build_object(candidate->>'id', slot_record.idx);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function beta_private.match_owned_athlete(jsonb,jsonb,jsonb,jsonb,integer[])
  from public, anon, authenticated, service_role;

create or replace function beta_private.draft_completion(
  league uuid, chosen uuid default null, chosen_team uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  candidates jsonb;
  slots jsonb;
  owners jsonb := '{}'::jsonb;
  owned_candidate jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', a.athlete_id, 'positions', a.positions,
    'owner', case when a.athlete_id = chosen then chosen_team else r.fantasy_team_id end
  ) order by
    (case when a.athlete_id = chosen then chosen_team else r.fantasy_team_id end is null),
    a.athlete_id
  ) into candidates
  from public.leagues l
  join public.player_pools p on p.id = l.pool_id
  join public.pool_competitions pc on pc.pool_id = p.id
  join public.athlete_seasons a on a.competition_id = pc.competition_id
    and a.season_id = p.season_id and a.draft_eligible
  left join public.roster_entries r on r.league_id = l.id
    and r.athlete_id = a.athlete_id and r.released_at is null
  where l.id = league;

  select jsonb_agg(jsonb_build_object(
    'team', t.id, 'code', sr.slot_code, 'positions', sr.allowed_positions
  ) order by sr.is_starter desc, t.id, sr.slot_code, n) into slots
  from public.fantasy_teams t
  join public.leagues l on l.id = t.league_id
  join public.roster_slot_rules sr on sr.ruleset_id = l.ruleset_id
  cross join lateral generate_series(1, sr.slot_count) n
  where l.id = league;

  if candidates is null or slots is null
    or jsonb_array_length(candidates) < jsonb_array_length(slots) then return null; end if;
  for owned_candidate in select value from jsonb_array_elements(candidates)
    where value->>'owner' is not null loop
    owners := beta_private.match_owned_athlete(owned_candidate, candidates, slots, owners, '{}');
    if owners is null then return null; end if;
  end loop;
  for i in 0..jsonb_array_length(slots) - 1 loop
    if exists(select 1 from jsonb_each_text(owners) where value::integer = i) then continue; end if;
    owners := beta_private.match_slot(i, candidates, slots, owners, '{}');
    if owners is null then return null; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(candidates) c
    where c->>'owner' is not null and not (owners ? (c->>'id'))) then return null; end if;
  return jsonb_build_object('owners', owners, 'slots', slots);
end;
$$;
