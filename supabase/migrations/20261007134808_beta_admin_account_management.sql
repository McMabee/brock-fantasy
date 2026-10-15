create table beta_private.admin_role_managers (
  user_id uuid primary key references public.profiles(id) on delete cascade
);
alter table beta_private.admin_role_managers enable row level security;
revoke all on beta_private.admin_role_managers from public, anon, authenticated, service_role;

-- The named operator controls staff privileges. Staff admin roles alone do not
-- confer this separate capability. Local fixtures provision their own operator.
with inserted as (
  insert into beta_private.admin_role_managers(user_id)
  select u.id from auth.users u join public.profiles p on p.id=u.id
  where lower(u.email)='tymabee@proton.me' and u.email_confirmed_at is not null
    and p.deleted_at is null
  on conflict do nothing returning user_id
)
insert into public.audit_log(action,entity_type,entity_id,after_state)
select 'admin.role_manager_bootstrap','profile',user_id::text,
  jsonb_build_object('capability','manage_admin_accounts','source','named-operator-migration')
from inserted;

create function beta_private.can_manage_admin_accounts() returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=beta_private.require_user(); begin
  return coalesce(auth.jwt()->>'aal','aal1')='aal2'
    and exists(select 1 from public.user_roles where user_id=u and role='admin')
    and exists(select 1 from beta_private.admin_role_managers where user_id=u)
    and exists(select 1 from public.profiles where id=u and deleted_at is null);
end $$;

create function beta_private.admin_find_account(p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Operator MFA access required' using errcode='42501';
  end if;
  if p_email is null or char_length(btrim(p_email)) not between 3 and 320 then
    raise exception 'Valid account email required' using errcode='22023';
  end if;
  select jsonb_build_object('found',true,'id',u.id,'email',u.email,
    'displayName',p.display_name,'emailVerified',u.email_confirmed_at is not null,
    'eligible',exists(select 1 from beta_private.account_eligibility_attestations a where a.user_id=u.id),
    'totpEnrolled',exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status='verified'),
    'isAdmin',exists(select 1 from public.user_roles r where r.user_id=u.id and r.role='admin'),
    'protectedOperator',exists(select 1 from beta_private.admin_role_managers m where m.user_id=u.id))
  into result from auth.users u join public.profiles p on p.id=u.id
  where lower(u.email)=lower(btrim(p_email)) and p.deleted_at is null;
  return coalesce(result,jsonb_build_object('found',false));
end $$;

create function beta_private.admin_set_account_role(
  p_user_id uuid,p_enabled boolean,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; previous jsonb; result jsonb; was_admin boolean; changed boolean; audit_id bigint;
begin
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Operator MFA access required' using errcode='42501';
  end if;
  u:=auth.uid();
  if p_enabled is null or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then
    raise exception 'An audit reason of 8 to 500 characters is required' using errcode='22023';
  end if;
  previous:=beta_private.begin_command('admin_set_account_role',p_idempotency_key);
  if previous is not null then return previous; end if;
  perform pg_advisory_xact_lock(hashtextextended('brock-admin-role-management',0));
  if not exists(select 1 from public.profiles where id=p_user_id and deleted_at is null) then
    raise exception 'Active account required' using errcode='22023';
  end if;
  if not p_enabled and (p_user_id=u or exists(select 1 from beta_private.admin_role_managers where user_id=p_user_id)) then
    raise exception 'Protected operator access cannot be revoked here' using errcode='42501';
  end if;
  if p_enabled and (
    not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null)
    or not exists(select 1 from beta_private.account_eligibility_attestations where user_id=p_user_id)
    or not exists(select 1 from auth.mfa_factors where user_id=p_user_id and factor_type='totp' and status='verified')
  ) then
    raise exception 'Verified email, eligibility and enrolled TOTP required' using errcode='22023';
  end if;
  select exists(select 1 from public.user_roles where user_id=p_user_id and role='admin') into was_admin;
  changed:=was_admin is distinct from p_enabled;
  if p_enabled then
    insert into public.user_roles(user_id,role,granted_by) values(p_user_id,'admin',u) on conflict do nothing;
  else
    delete from public.user_roles where user_id=p_user_id and role='admin';
  end if;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_state,after_state,request_id)
  values(u,'admin.account_role_changed','profile',p_user_id::text,
    jsonb_build_object('admin',was_admin),jsonb_build_object('admin',p_enabled,'reason',btrim(p_reason),'changed',changed),p_idempotency_key)
  returning id into audit_id;
  result:=jsonb_build_object('userId',p_user_id,'enabled',p_enabled,'changed',changed,'auditId',audit_id);
  return beta_private.finish_command('admin_set_account_role',p_idempotency_key,result);
end $$;

create function public.can_manage_admin_accounts() returns boolean
language sql security invoker set search_path='' as $$ select beta_private.can_manage_admin_accounts(); $$;
create function public.admin_find_account(p_email text) returns jsonb
language sql security invoker set search_path='' as $$ select beta_private.admin_find_account(p_email); $$;
create function public.admin_set_account_role(p_user_id uuid,p_enabled boolean,p_reason text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$
  select beta_private.admin_set_account_role(p_user_id,p_enabled,p_reason,p_idempotency_key);
$$;
revoke all on function beta_private.can_manage_admin_accounts(),beta_private.admin_find_account(text),
  beta_private.admin_set_account_role(uuid,boolean,text,text),public.can_manage_admin_accounts(),
  public.admin_find_account(text),public.admin_set_account_role(uuid,boolean,text,text)
from public,anon,authenticated,service_role;
grant usage on schema beta_private to authenticated;
grant execute on function beta_private.can_manage_admin_accounts(),beta_private.admin_find_account(text),
  beta_private.admin_set_account_role(uuid,boolean,text,text),public.can_manage_admin_accounts(),
  public.admin_find_account(text),public.admin_set_account_role(uuid,boolean,text,text) to authenticated;
