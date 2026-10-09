-- Keep privileged implementations outside the exposed API schemas. Moving the
-- originals preserves their OIDs, owners, bodies, defaults and RLS dependencies;
-- public invoker wrappers preserve the web/native RPC contract.
-- Do not add rpc_private to api.schemas or the PostgREST exposed schemas.
create schema rpc_private;
revoke all on schema rpc_private from public, anon, authenticated, service_role;
grant usage on schema rpc_private to anon, authenticated, service_role;

do $migration$
declare
  signature text;
  implementation record;
  identity_arguments text;
  declared_arguments text;
  result_type text;
  call_arguments text;
  select_expression text;
  volatility text;
  parallel_mode text;
  authenticated_execute boolean;
  service_execute boolean;
begin
  -- Explicitly bounded to the 37 signatures in the October 9 advisor report,
  -- including both draft overloads. Service-only workers/internal functions are
  -- intentionally excluded.
  foreach signature in array array[
    'public.add_free_agent(uuid,uuid,uuid,text)',
    'public.admin_adjust_score(uuid,uuid,uuid,numeric,text,text)',
    'public.cancel_trade(uuid,text)',
    'public.create_beta_league(text,uuid,integer,text)',
    'public.create_league(text,uuid,public.league_format,text)',
    'public.current_user_is_admin()',
    'public.disable_push_token(text)',
    'public.generate_matchup_schedule(uuid,timestamptz,integer,text)',
    'public.get_athlete_adp(uuid,uuid,integer)',
    'public.get_beta_lineup(uuid)',
    'public.get_league_standings(uuid)',
    'public.is_league_commissioner(uuid)',
    'public.is_league_member(uuid)',
    'public.join_league(text,text,text)',
    'public.make_draft_pick(uuid,uuid,text,public.draft_pick_source)',
    'public.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint)',
    'public.mark_notification_read(uuid,text)',
    'public.moderate_chat_message(uuid,boolean,text,text)',
    'public.mute_chat_user(uuid,uuid)',
    'public.owns_fantasy_team(uuid)',
    'public.post_chat_message(uuid,text,text)',
    'public.preview_game_revision(uuid,bigint,jsonb)',
    'public.propose_trade(uuid,uuid,uuid[],uuid[],timestamptz,text)',
    'public.publish_game_revision(uuid,bigint,public.game_status,integer,integer,jsonb,text,text,text)',
    'public.register_push_token(text,text)',
    'public.replay_game(uuid,text)',
    'public.report_chat_message(uuid,text)',
    'public.request_waiver(uuid,uuid,uuid,text)',
    'public.respond_to_trade(uuid,boolean,text)',
    'public.set_draft_queue(uuid,uuid[],text)',
    'public.set_draft_status(uuid,public.draft_status,text)',
    'public.set_draft_status(uuid,text,text)',
    'public.set_lineup(uuid,uuid,jsonb,text)',
    'public.set_period_lineup(uuid,jsonb,bigint,text)',
    'public.shares_league(uuid)',
    'public.start_draft(uuid,integer,integer,text)',
    'public.vote_trade(uuid,text)'
  ] loop
    select p.* into strict implementation
    from pg_catalog.pg_proc p
    where p.oid = signature::regprocedure;
    if not implementation.prosecdef then
      raise exception 'Expected a definer implementation for %', signature;
    end if;

    identity_arguments := pg_catalog.pg_get_function_identity_arguments(implementation.oid);
    declared_arguments := pg_catalog.pg_get_function_arguments(implementation.oid);
    result_type := pg_catalog.pg_get_function_result(implementation.oid);
    authenticated_execute := pg_catalog.has_function_privilege('authenticated', implementation.oid, 'EXECUTE');
    service_execute := pg_catalog.has_function_privilege('service_role', implementation.oid, 'EXECUTE');
    select coalesce(string_agg('$' || n::text, ', ' order by n), '') into call_arguments
    from generate_series(1, implementation.pronargs) n;
    select_expression := case when implementation.proretset then 'select * from' else 'select' end;
    volatility := case implementation.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end;
    parallel_mode := case implementation.proparallel when 's' then 'safe' when 'r' then 'restricted' else 'unsafe' end;

    execute format('alter function public.%I(%s) set schema rpc_private', implementation.proname, identity_arguments);

    -- Reset privileges explicitly: PostgreSQL's built-in PUBLIC EXECUTE default
    -- is not removed by a per-schema ALTER DEFAULT PRIVILEGES ... REVOKE.
    execute format('revoke all on function rpc_private.%I(%s) from public, anon, authenticated, service_role', implementation.proname, identity_arguments);
    if authenticated_execute then
      execute format('grant execute on function rpc_private.%I(%s) to authenticated', implementation.proname, identity_arguments);
    end if;
    if service_execute then
      execute format('grant execute on function rpc_private.%I(%s) to service_role', implementation.proname, identity_arguments);
    end if;
    if implementation.proname = 'current_user_is_admin' then
      -- Existing anonymous SELECT policies reference the original function OID.
      -- Their boolean authorization check stays callable only in this unexposed
      -- schema. Anon gets no access to beta_private or any other implementation.
      execute 'grant execute on function rpc_private.current_user_is_admin() to anon';
    end if;

    execute format(
      'create function public.%I(%s) returns %s language sql %s security invoker parallel %s %s cost %s %s set search_path = %L as %L',
      implementation.proname,
      declared_arguments,
      result_type,
      volatility,
      parallel_mode,
      case when implementation.proisstrict then 'strict' else 'called on null input' end,
      implementation.procost,
      case when implementation.proretset then 'rows ' || implementation.prorows::text else '' end,
      '',
      format('%s rpc_private.%I(%s);', select_expression, implementation.proname, call_arguments)
    );
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated, service_role', implementation.proname, identity_arguments);
    if authenticated_execute then
      execute format('grant execute on function public.%I(%s) to authenticated', implementation.proname, identity_arguments);
    end if;
    if service_execute then
      execute format('grant execute on function public.%I(%s) to service_role', implementation.proname, identity_arguments);
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'An API-exposed client-callable definer remains';
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
