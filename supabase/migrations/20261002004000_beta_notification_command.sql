-- Web sessions use cookie-authenticated commands. Keep notification mutations
-- in that same trusted path so no browser bearer credential is needed.
create function public.mark_notification_read(p_notification_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  was_read timestamptz;
begin
  existing := beta_private.begin_command('mark_notification_read', p_idempotency_key);
  if existing is not null then return existing; end if;

  select read_at into was_read
  from public.notifications
  where id = p_notification_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Notification not found'; end if;

  if was_read is null then
    update public.notifications set read_at = clock_timestamp() where id = p_notification_id;
  end if;
  perform beta_private.audit('notification.read', 'notification', p_notification_id::text, null, jsonb_build_object('was_read', was_read is not null), p_idempotency_key);
  return beta_private.finish_command('mark_notification_read', p_idempotency_key, jsonb_build_object('notification_id', p_notification_id, 'read', true));
end;
$$;

revoke all on function public.mark_notification_read(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_notification_read(uuid, text) to authenticated;
