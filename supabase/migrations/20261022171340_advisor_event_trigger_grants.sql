set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Preserve the hosted automatic RLS trigger and its owner-only DDL capability
-- - Some local installations do not install the optional event trigger
do $$
declare target oid := to_regprocedure('public.rls_auto_enable()');
begin
  if target is null then return; end if;
  if (select prorettype <> 'event_trigger'::regtype from pg_proc where oid = target) then
    raise exception 'Unexpected rls_auto_enable signature';
  end if;
  revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
end;
$$;

notify pgrst, 'reload schema';
