-- - Keep the approved default unless the commissioner saves a league-specific pick timer
alter table public.leagues add column draft_pick_seconds integer
  check (draft_pick_seconds between 20 and 86400);

create function rpc_private.set_league_pick_duration(p_league_id uuid,p_pick_seconds integer,p_expected_version bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; existing jsonb;
begin
  perform rpc_private.require_app_access();
  existing:=beta_private.begin_command('set_league_pick_duration',p_idempotency_key);
  if existing is not null then return existing; end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id for update;
  if l.id is null or not public.is_league_commissioner(l.id) then raise exception 'Commissioner access required' using errcode='42501'; end if;
  if l.status<>'setup' or exists(select 1 from public.drafts where league_id=l.id) then
    raise exception 'Pick duration can only change before the draft starts' using errcode='22023';
  end if;
  if p_expected_version is null or p_expected_version<>l.state_version then raise exception 'League changed; refresh and retry' using errcode='40001'; end if;
  if p_pick_seconds is null or p_pick_seconds not between 20 and 86400 then
    raise exception 'Pick duration must be between 20 and 86400 seconds' using errcode='22023';
  end if;
  update public.leagues set draft_pick_seconds=p_pick_seconds,state_version=state_version+1 where id=l.id returning * into l;
  perform beta_private.audit('draft.pick_duration_changed','league',l.id::text,null,
    jsonb_build_object('pick_seconds',p_pick_seconds),p_idempotency_key);
  return beta_private.finish_command('set_league_pick_duration',p_idempotency_key,
    jsonb_build_object('league_id',l.id,'pick_seconds',p_pick_seconds,'state_version',l.state_version));
end;
$$;
create function public.set_league_pick_duration(p_league_id uuid,p_pick_seconds integer,p_expected_version bigint,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$
  select rpc_private.set_league_pick_duration(p_league_id,p_pick_seconds,p_expected_version,p_idempotency_key);
$$;
revoke all on function public.set_league_pick_duration(uuid,integer,bigint,text),rpc_private.set_league_pick_duration(uuid,integer,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.set_league_pick_duration(uuid,integer,bigint,text),rpc_private.set_league_pick_duration(uuid,integer,bigint,text) to authenticated;

-- - Start both supported draft formats with the saved timer and retain their existing legality checks
create or replace function public.legacy_start_draft(
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
  if p_rounds < 1 or p_pick_seconds is null or p_pick_seconds not between 20 and 86400 then raise exception 'Invalid draft configuration'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_league_id::text || ':start_draft', 0));
  select response into v_existing from public.idempotency_keys
    where user_id = v_user_id and command = 'start_draft' and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select count(*), array_agg(id order by draft_position, created_at)
  into v_team_count, v_team_order
  from public.fantasy_teams where league_id = p_league_id and owner_id is not null;
  if v_team_count < 2 then raise exception 'A draft requires at least two teams'; end if;
  if exists (select 1 from public.drafts where league_id = p_league_id) then raise exception 'Draft already exists'; end if;
  select sum(sr.slot_count), coalesce(l.draft_pick_seconds, (r.draft_config ->> 'pickSeconds')::integer)
  into v_ruleset_rounds, v_ruleset_pick_seconds
  from public.leagues l
  join public.scoring_rulesets r on r.id = l.ruleset_id
  join public.roster_slot_rules sr on sr.ruleset_id = r.id
  where l.id = p_league_id and r.status = 'approved'
  group by r.draft_config, l.draft_pick_seconds;
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

create or replace function rpc_private.start_draft(p_league_id uuid,p_rounds integer,p_pick_seconds integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; p public.player_pools%rowtype; existing jsonb; ordering uuid[]; d uuid; ranks jsonb; begin
  perform rpc_private.require_app_access();
  if p_pick_seconds is null or p_pick_seconds not between 20 and 86400 then raise exception 'Pick duration must be between 20 and 86400 seconds' using errcode='22023'; end if;
  perform beta_private.league_lock(p_league_id);
  select * into l from public.leagues where id=p_league_id;
  if l.pool_id is null then return public.legacy_start_draft(p_league_id,p_rounds,p_pick_seconds,p_idempotency_key); end if;
  existing:=beta_private.begin_command('start_draft',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(l.id);
  select * into l from public.leagues where id=p_league_id for update;
  if not public.is_league_commissioner(l.id) then raise exception 'Commissioner access required'; end if;
  if l.status<>'setup' or p_rounds is distinct from 10 or p_pick_seconds is distinct from coalesce(l.draft_pick_seconds,120) then raise exception 'Draft requires ten rounds and the saved pick duration'; end if;
  select * into p from public.player_pools where id=l.pool_id for share;
  if not p.is_active or p.rankings_approved_at is null then raise exception 'Approved player pool and rankings required'; end if;
  if now()>=(select min(starts_at) from public.fantasy_periods where season_id=p.season_id) then raise exception 'The season has started'; end if;
  if (select count(*) from public.fantasy_teams where league_id=l.id and owner_id is not null)<>l.max_members then raise exception 'All manager places must be filled'; end if;
  if beta_private.draft_completion(l.id) is null then raise exception 'Player pool cannot fill legal rosters for every team'; end if;
  select array_agg(id order by extensions.gen_random_bytes(16)) into ordering from public.fantasy_teams where league_id=l.id;
  update public.fantasy_teams set draft_position=null where league_id=l.id;
  update public.fantasy_teams t set draft_position=o.n,waiver_priority=l.max_members+1-o.n,preseason_order=o.n
  from unnest(ordering) with ordinality o(id,n) where t.id=o.id;
  select jsonb_agg(jsonb_build_object('athlete_id',r.athlete_id,'rank',r.rank) order by r.rank) into ranks from public.pool_rankings r where r.pool_id=p.id and r.reviewed;
  if exists(select 1 from public.athlete_seasons a join public.pool_competitions pc on pc.competition_id=a.competition_id and pc.pool_id=p.id where a.season_id=p.season_id and a.draft_eligible and not exists(select 1 from public.pool_rankings r where r.pool_id=p.id and r.athlete_id=a.athlete_id and r.reviewed)) then raise exception 'Every eligible athlete requires a reviewed rank'; end if;
  insert into public.drafts(league_id,status,rounds,pick_seconds,team_order,pick_deadline,starts_at,league_size,ranking_version,rankings_snapshot,is_test)
  values(l.id,'active',10,p_pick_seconds,ordering,now()+make_interval(secs=>p_pick_seconds),now(),l.max_members,p.rankings_version,ranks,true) returning id into d;
  update public.leagues set status='drafting',state_version=state_version+1 where id=l.id;
  perform beta_private.audit('draft.started','draft',d::text,null,jsonb_build_object('order',ordering,'ranking_version',p.rankings_version),p_idempotency_key);
  return beta_private.finish_command('start_draft',p_idempotency_key,jsonb_build_object('draft_id',d,'state_version',1));
end $$;


notify pgrst, 'reload schema';
