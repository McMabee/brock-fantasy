-- Keep the legacy signature for cached command retries, but require an explicit
-- team name for every new league. Older clients receive an actionable error.
create or replace function rpc_private.create_beta_league(
  p_name text,
  p_pool_id uuid,
  p_max_members integer,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing jsonb;
begin
  perform rpc_private.require_app_access();
  existing := beta_private.begin_command('create_beta_league', p_idempotency_key);
  if existing is not null then return existing; end if;
  raise exception 'Fantasy team name is required. Update the app and try again.' using errcode = '22023';
end;
$$;

create function rpc_private.create_beta_league(
  p_name text,
  p_pool_id uuid,
  p_max_members integer,
  p_idempotency_key text,
  p_team_name text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing jsonb;
  pool public.player_pools%rowtype;
  v_league_id uuid;
begin
  perform rpc_private.require_app_access();
  existing := beta_private.begin_command('create_beta_league', p_idempotency_key);
  if existing is not null then return existing; end if;
  if p_name is null or char_length(btrim(p_name)) not between 3 and 60
    or p_max_members is null or p_max_members not in (4, 6, 8, 10) then
    raise exception 'Invalid league name or size' using errcode = '22023';
  end if;
  if p_team_name is null or char_length(btrim(p_team_name)) not between 3 and 60 then
    raise exception 'Team name must be 3 to 60 characters' using errcode = '22023';
  end if;
  select * into pool from public.player_pools where id = p_pool_id and is_active;
  if pool.id is null then raise exception 'Player pool is not active'; end if;
  if now() >= (select min(starts_at) from public.fantasy_periods where season_id = pool.season_id) then
    raise exception 'Season registration has closed';
  end if;

  insert into public.leagues(pool_id, commissioner_id, ruleset_id, name, format, max_members, invite_code)
  values(pool.id, auth.uid(), pool.ruleset_id, btrim(p_name), 'head_to_head', p_max_members,
    upper(encode(extensions.gen_random_bytes(6), 'hex')))
  returning id into v_league_id;
  insert into public.league_members(league_id, user_id, role)
  values(v_league_id, auth.uid(), 'commissioner');
  insert into public.fantasy_teams(league_id, owner_id, name, draft_position, waiver_priority)
  values(v_league_id, auth.uid(), btrim(p_team_name), 1, 1);
  perform beta_private.audit('league.created', 'league', v_league_id::text, null,
    jsonb_build_object('pool_id', pool.id, 'size', p_max_members, 'team_name', btrim(p_team_name)),
    p_idempotency_key);
  return beta_private.finish_command('create_beta_league', p_idempotency_key,
    jsonb_build_object('league_id', v_league_id, 'state_version', 1));
end;
$$;

create function public.create_beta_league(
  p_name text,
  p_pool_id uuid,
  p_max_members integer,
  p_idempotency_key text,
  p_team_name text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform rpc_private.require_app_access();
  return rpc_private.create_beta_league(p_name, p_pool_id, p_max_members, p_idempotency_key, p_team_name);
end;
$$;

create function rpc_private.delete_league(
  p_league_id uuid,
  p_confirmation_name text,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  existing jsonb;
  league public.leagues%rowtype;
begin
  perform rpc_private.require_app_access();
  v_user_id := beta_private.require_user();
  existing := beta_private.begin_command('delete_league', p_idempotency_key);
  if existing is not null then
    if existing->>'league_id' is distinct from p_league_id::text then
      raise exception 'Idempotency key belongs to another league' using errcode = '22023';
    end if;
    return existing;
  end if;
  perform beta_private.league_lock(p_league_id);
  select * into league from public.leagues where id = p_league_id for update;
  -- The admin helper permits global administrators. Deletion instead requires
  -- this league's actual commissioner, even when the caller is an admin at AAL2.
  if league.id is null or league.commissioner_id is distinct from v_user_id
    or not exists(select 1 from public.league_members m
      where m.league_id = p_league_id and m.user_id = v_user_id and m.role = 'commissioner') then
    raise exception 'Commissioner access required' using errcode = '42501';
  end if;
  if p_confirmation_name is null or btrim(p_confirmation_name) <> league.name then
    raise exception 'Type the league name to confirm deletion' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version <> league.state_version then
    raise exception 'League changed. Refresh league controls and confirm again.' using errcode = '40001';
  end if;

  -- These beta history tables have restrictive foreign keys. Remove their rows
  -- before the league's cascades remove teams, rosters, drafts and league chat.
  delete from public.period_lineup_locks where league_id = p_league_id;
  delete from public.roster_slot_history h using public.roster_entries r
    where h.roster_entry_id = r.id and r.league_id = p_league_id;
  delete from public.trade_votes v using public.trades t
    where v.trade_id = t.id and t.league_id = p_league_id;
  delete from public.trades where league_id = p_league_id;
  delete from public.matchups where league_id = p_league_id;
  delete from public.leagues where id = p_league_id;

  perform beta_private.audit('league.deleted', 'league', p_league_id::text,
    jsonb_build_object('name', league.name, 'commissioner_id', league.commissioner_id,
      'status', league.status, 'state_version', league.state_version),
    jsonb_build_object('deleted', true), p_idempotency_key);
  return beta_private.finish_command('delete_league', p_idempotency_key,
    jsonb_build_object('league_id', p_league_id, 'deleted', true));
end;
$$;

create function public.delete_league(
  p_league_id uuid,
  p_confirmation_name text,
  p_expected_version bigint,
  p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform rpc_private.require_app_access();
  return rpc_private.delete_league(p_league_id, p_confirmation_name, p_expected_version, p_idempotency_key);
end;
$$;

revoke all on function rpc_private.create_beta_league(text, uuid, integer, text, text),
  public.create_beta_league(text, uuid, integer, text, text),
  rpc_private.delete_league(uuid, text, bigint, text), public.delete_league(uuid, text, bigint, text)
from public, anon, authenticated, service_role;
grant execute on function rpc_private.create_beta_league(text, uuid, integer, text, text),
  public.create_beta_league(text, uuid, integer, text, text),
  rpc_private.delete_league(uuid, text, bigint, text), public.delete_league(uuid, text, bigint, text)
to authenticated;

notify pgrst, 'reload schema';
