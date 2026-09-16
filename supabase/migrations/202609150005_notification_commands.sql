create or replace function public.register_push_token(p_expo_push_token text, p_platform text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'Unsupported push platform'; end if;
  if p_expo_push_token !~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$'
    and p_expo_push_token !~ '^ExpoPushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Invalid Expo push token';
  end if;
  insert into public.push_tokens (user_id, expo_push_token, platform, enabled)
  values (auth.uid(), p_expo_push_token, p_platform, true)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id, platform = excluded.platform, enabled = true, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.disable_push_token(p_expo_push_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_tokens set enabled = false, updated_at = now()
  where user_id = auth.uid() and expo_push_token = p_expo_push_token;
$$;

revoke all on function public.register_push_token(text, text) from public, anon, authenticated, service_role;
revoke all on function public.disable_push_token(text) from public, anon, authenticated, service_role;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.disable_push_token(text) to authenticated;
