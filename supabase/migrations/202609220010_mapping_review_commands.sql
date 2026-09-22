create or replace function public.review_provider_mapping(
  p_mapping_id uuid,
  p_verified boolean,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_mapping public.provider_entity_mappings%rowtype;
  v_existing jsonb;
  v_response jsonb;
  v_target_exists boolean := false;
begin
  if v_user_id is null or not public.current_user_is_admin() then
    raise exception 'Administrator with MFA required';
  end if;
  if p_verified is null then raise exception 'Mapping decision is required'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 8 and 500 then
    raise exception 'A review reason between 8 and 500 characters is required';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception 'Invalid idempotency key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('provider_mapping:' || p_mapping_id::text, 0));
  select response into v_existing
  from public.idempotency_keys
  where user_id = v_user_id
    and command = 'review_provider_mapping'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_mapping
  from public.provider_entity_mappings
  where id = p_mapping_id
  for update;
  if v_mapping.id is null then raise exception 'Provider mapping not found'; end if;
  if (v_mapping.verified_at is not null) = p_verified then
    raise exception 'Provider mapping already has the requested review state';
  end if;

  if p_verified then
    case v_mapping.entity_type
      when 'competition' then
        select exists (
          select 1 from public.competitions where id = v_mapping.internal_entity_id
        ) into v_target_exists;
      when 'team' then
        select exists (
          select 1 from public.teams where id = v_mapping.internal_entity_id
        ) into v_target_exists;
      when 'athlete' then
        select exists (
          select 1 from public.athletes where id = v_mapping.internal_entity_id
        ) into v_target_exists;
      when 'game' then
        select exists (
          select 1 from public.games where id = v_mapping.internal_entity_id
        ) into v_target_exists;
      else
        v_target_exists := false;
    end case;
    if not v_target_exists then raise exception 'Mapping target does not exist'; end if;
  end if;

  update public.provider_entity_mappings
  set
    verified_at = case when p_verified then now() else null end,
    verified_by = case when p_verified then v_user_id else null end
  where id = p_mapping_id;

  v_response := jsonb_build_object(
    'mapping_id', p_mapping_id,
    'verified', p_verified,
    'changed_at', now()
  );
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'review_provider_mapping', p_idempotency_key, v_response);
  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    request_id
  )
  values (
    v_user_id,
    case when p_verified then 'provider_mapping.verified' else 'provider_mapping.reopened' end,
    'provider_entity_mapping',
    p_mapping_id::text,
    jsonb_build_object(
      'verified_at', v_mapping.verified_at,
      'verified_by', v_mapping.verified_by,
      'internal_entity_id', v_mapping.internal_entity_id
    ),
    jsonb_build_object('verified', p_verified, 'reason', trim(p_reason)),
    p_idempotency_key
  );
  return v_response;
end;
$$;

create or replace function public.resolve_sync_error(
  p_sync_error_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_error public.sync_errors%rowtype;
  v_provider text;
  v_provider_athlete_id text;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user_id is null or not public.current_user_is_admin() then
    raise exception 'Administrator with MFA required';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 8 and 500 then
    raise exception 'A resolution reason between 8 and 500 characters is required';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception 'Invalid idempotency key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sync_error:' || p_sync_error_id::text, 0));
  select response into v_existing
  from public.idempotency_keys
  where user_id = v_user_id
    and command = 'resolve_sync_error'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_error
  from public.sync_errors
  where id = p_sync_error_id
  for update;
  if v_error.id is null then raise exception 'Sync error not found'; end if;
  if v_error.resolved_at is not null then raise exception 'Sync error is already resolved'; end if;

  if v_error.error_code = 'UNMAPPED_ATHLETE' then
    select provider into v_provider from public.sync_runs where id = v_error.sync_run_id;
    v_provider_athlete_id := v_error.context ->> 'providerAthleteId';
    if v_provider is null or v_provider_athlete_id is null or not exists (
      select 1
      from public.provider_entity_mappings
      where provider = v_provider
        and entity_type = 'athlete'
        and provider_entity_id = v_provider_athlete_id
        and verified_at is not null
    ) then
      raise exception 'A verified athlete mapping is required before resolving this error';
    end if;
  end if;

  update public.sync_errors
  set resolved_at = now(), resolved_by = v_user_id
  where id = p_sync_error_id;

  v_response := jsonb_build_object(
    'sync_error_id', p_sync_error_id,
    'resolved', true,
    'changed_at', now()
  );
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'resolve_sync_error', p_idempotency_key, v_response);
  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    request_id
  )
  values (
    v_user_id,
    'sync_error.resolved',
    'sync_error',
    p_sync_error_id::text,
    jsonb_build_object('error_code', v_error.error_code, 'resolved_at', v_error.resolved_at),
    jsonb_build_object('resolved', true, 'reason', trim(p_reason)),
    p_idempotency_key
  );
  return v_response;
end;
$$;

revoke insert, update, delete on public.provider_entity_mappings from authenticated;
revoke insert, update, delete on public.sync_errors from authenticated;

revoke all on function public.review_provider_mapping(uuid, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_sync_error(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_provider_mapping(uuid, boolean, text, text)
  to authenticated;
grant execute on function public.resolve_sync_error(uuid, text, text)
  to authenticated;
