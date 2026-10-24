set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Return the bounded inbox and exact unread count from the same statement snapshot
create function rpc_private.get_notification_snapshot(p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare owner uuid := auth.uid(); result jsonb;
begin
  perform rpc_private.require_app_access();
  select jsonb_build_object(
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc, n.id desc), '[]'::jsonb)
      from (select id, kind, title, body, data, read_at, created_at from public.notifications
        where user_id = owner order by created_at desc, id desc limit greatest(1, least(coalesce(p_limit, 100), 100))) n),
    'unreadCount', (select count(*) from public.notifications where user_id = owner and read_at is null)
  ) into result;
  return result;
end;
$$;
create function public.get_notification_snapshot(p_limit integer default 100) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select rpc_private.get_notification_snapshot(p_limit);
$$;
revoke all on function public.get_notification_snapshot(integer), rpc_private.get_notification_snapshot(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_notification_snapshot(integer), rpc_private.get_notification_snapshot(integer) to authenticated;

notify pgrst, 'reload schema';
