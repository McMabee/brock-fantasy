create table public.competition_ingestion_controls (
  competition_id uuid primary key references public.competitions(id) on delete cascade,
  ingestion_paused boolean not null default false,
  ingestion_pause_reason text,
  ingestion_paused_at timestamptz,
  ingestion_paused_by uuid references public.profiles(id) on delete set null,
  constraint competition_ingestion_controls_pause_state check (
    (
      not ingestion_paused
      and ingestion_pause_reason is null
      and ingestion_paused_at is null
      and ingestion_paused_by is null
    )
    or (
      ingestion_paused
      and char_length(trim(coalesce(ingestion_pause_reason, ''))) between 8 and 500
      and ingestion_paused_at is not null
    )
  )
);

insert into public.competition_ingestion_controls (competition_id)
select id from public.competitions;

alter table public.competition_ingestion_controls enable row level security;
create policy competition_ingestion_controls_admin_read
  on public.competition_ingestion_controls
  for select to authenticated
  using (public.current_user_is_admin());

revoke all on table public.competition_ingestion_controls
  from public, anon, authenticated, service_role;
grant select on table public.competition_ingestion_controls to authenticated, service_role;

alter table public.provider_raw_receipts
  drop constraint provider_raw_receipts_validation_status_check,
  add constraint provider_raw_receipts_validation_status_check
    check (validation_status in ('received', 'accepted', 'rejected', 'held'));

create index competition_ingestion_controls_paused
  on public.competition_ingestion_controls (ingestion_paused_at desc)
  where ingestion_paused;

create or replace function public.set_competition_ingestion_status(
  p_competition_id uuid,
  p_paused boolean,
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
  v_control public.competition_ingestion_controls%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user_id is null or not public.current_user_is_admin() then
    raise exception 'Administrator with MFA required';
  end if;
  if p_paused is null then raise exception 'Ingestion status is required'; end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 8 and 500 then
    raise exception 'An incident reason between 8 and 500 characters is required';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 200 then
    raise exception 'Invalid idempotency key';
  end if;
  if not exists (select 1 from public.competitions where id = p_competition_id) then
    raise exception 'Competition not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('competition_ingestion:' || p_competition_id::text, 0)
  );
  select response into v_existing
  from public.idempotency_keys
  where user_id = v_user_id
    and command = 'set_competition_ingestion_status'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_control
  from public.competition_ingestion_controls
  where competition_id = p_competition_id
  for update;

  insert into public.competition_ingestion_controls (
    competition_id,
    ingestion_paused,
    ingestion_pause_reason,
    ingestion_paused_at,
    ingestion_paused_by
  )
  values (
    p_competition_id,
    p_paused,
    case when p_paused then trim(p_reason) else null end,
    case when p_paused then now() else null end,
    case when p_paused then v_user_id else null end
  )
  on conflict (competition_id) do update
  set
    ingestion_paused = excluded.ingestion_paused,
    ingestion_pause_reason = excluded.ingestion_pause_reason,
    ingestion_paused_at = excluded.ingestion_paused_at,
    ingestion_paused_by = excluded.ingestion_paused_by;

  v_response := jsonb_build_object(
    'competition_id', p_competition_id,
    'ingestion_paused', p_paused,
    'reason', trim(p_reason),
    'changed_at', now()
  );
  insert into public.idempotency_keys (user_id, command, idempotency_key, response)
  values (v_user_id, 'set_competition_ingestion_status', p_idempotency_key, v_response);
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
    case when p_paused then 'ingestion.paused' else 'ingestion.resumed' end,
    'competition',
    p_competition_id::text,
    jsonb_build_object(
      'ingestion_paused', coalesce(v_control.ingestion_paused, false),
      'reason', v_control.ingestion_pause_reason
    ),
    v_response,
    p_idempotency_key
  );
  return v_response;
end;
$$;

revoke all on function public.set_competition_ingestion_status(uuid, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_competition_ingestion_status(uuid, boolean, text, text)
  to authenticated;
