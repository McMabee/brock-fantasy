-- - Resolve JSON RPC calls through one public signature while retaining the private enum implementation
create or replace function rpc_private.set_draft_status(
  p_draft_id uuid,
  p_status text,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select rpc_private.set_draft_status(p_draft_id, p_status::public.draft_status, p_idempotency_key);
$$;

-- - Keep the existing public invoker and its application eligibility check
-- - Restrict rejects unexpected dependencies instead of removing dependent objects
drop function public.set_draft_status(uuid, public.draft_status, text) restrict;

revoke all on function rpc_private.set_draft_status(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function rpc_private.set_draft_status(uuid, text, text) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_draft_status') <> 1
    or to_regprocedure('public.set_draft_status(uuid,text,text)') is null then
    raise exception 'Expected exactly one public draft status RPC';
  end if;
end;
$$;

notify pgrst, 'reload schema';
