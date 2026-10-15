-- Pin the single super administrator to the already verified named account.
-- Ordinary admin roles never confer this capability; metadata is not consulted.
delete from beta_private.admin_role_managers m
where not exists(select 1 from auth.users u where u.id=m.user_id
  and lower(u.email)='tymabee@proton.me' and u.email_confirmed_at is not null);
insert into beta_private.admin_role_managers(user_id)
select u.id from auth.users u join public.profiles p on p.id=u.id
where lower(u.email)='tymabee@proton.me' and u.email_confirmed_at is not null
  and p.deleted_at is null on conflict do nothing;
create unique index admin_single_super_administrator on beta_private.admin_role_managers ((true));
insert into public.user_roles(user_id,role)
select user_id,'admin' from beta_private.admin_role_managers on conflict do nothing;

create or replace function beta_private.can_manage_admin_accounts() returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid:=beta_private.require_user(); begin
  return coalesce(auth.jwt()->>'aal','aal1')='aal2'
    and exists(select 1 from public.user_roles where user_id=u and role='admin')
    and exists(select 1 from beta_private.admin_role_managers where user_id=u)
    and exists(select 1 from auth.users where id=u and lower(email)='tymabee@proton.me'
      and email_confirmed_at is not null)
    and exists(select 1 from public.profiles where id=u and deleted_at is null);
end $$;

create table beta_private.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  invited_by uuid not null references public.profiles(id),
  reason text not null check(char_length(reason) between 8 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  sent_at timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz
);
create unique index admin_one_pending_invitation on beta_private.admin_invitations(user_id)
where accepted_at is null and cancelled_at is null;
create index admin_invitation_inviter on beta_private.admin_invitations(invited_by);
alter table beta_private.admin_invitations enable row level security;
revoke all on beta_private.admin_invitations from public,anon,authenticated,service_role;

create function beta_private.admin_create_invitation(p_email text,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; target_email text; invitation beta_private.admin_invitations; previous jsonb; result jsonb;
begin
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Super administrator MFA access required' using errcode='42501';
  end if;
  if p_email is null or char_length(btrim(p_email)) not between 3 and 320
    or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then
    raise exception 'Valid email and an audit reason of 8 to 500 characters required' using errcode='22023';
  end if;
  previous:=beta_private.begin_command('admin_create_invitation',p_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended('brock-admin-role-management',0));
  if previous is not null then
    select * into invitation from beta_private.admin_invitations where id=(previous->>'invitationId')::uuid;
    if invitation.id is null or invitation.cancelled_at is not null or invitation.expires_at<=now() then
      raise exception 'Invitation is unavailable; find the account and send a new invitation' using errcode='22023';
    end if;
    return previous||jsonb_build_object('alreadySent',invitation.sent_at is not null);
  end if;
  select u.id,lower(u.email) into target_id,target_email
  from auth.users u join public.profiles p on p.id=u.id
  where lower(u.email)=lower(btrim(p_email)) and p.deleted_at is null
    and u.email_confirmed_at is not null
    and exists(select 1 from beta_private.account_eligibility_attestations a where a.user_id=u.id);
  if target_id is null then
    raise exception 'A registered account with verified email and confirmed eligibility is required' using errcode='22023';
  end if;
  if exists(select 1 from public.user_roles where user_id=target_id and role='admin') then
    raise exception 'This account is already an administrator' using errcode='22023';
  end if;
  if exists(select 1 from beta_private.admin_invitations where user_id=target_id
    and created_at>clock_timestamp()-interval '60 seconds') then
    raise exception 'Wait one minute before sending a new invitation' using errcode='P0001';
  end if;
  update beta_private.admin_invitations set cancelled_at=now()
  where user_id=target_id and accepted_at is null and cancelled_at is null;
  insert into beta_private.admin_invitations(user_id,email,invited_by,reason)
  values(target_id,target_email,auth.uid(),btrim(p_reason)) returning * into invitation;
  perform beta_private.audit('admin.invitation_created','admin_invitation',invitation.id::text,null,
    jsonb_build_object('userId',target_id,'expiresAt',invitation.expires_at,'reason',invitation.reason),p_idempotency_key);
  result:=jsonb_build_object('invitationId',invitation.id,'email',target_email,'expiresAt',invitation.expires_at);
  return beta_private.finish_command('admin_create_invitation',p_idempotency_key,result);
end $$;

create function beta_private.admin_mark_invitation_sent(p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invitation beta_private.admin_invitations;
begin
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Super administrator MFA access required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('brock-admin-role-management',0));
  select * into invitation from beta_private.admin_invitations where id=p_invitation_id for update;
  if invitation.id is null or invitation.invited_by<>auth.uid() or invitation.cancelled_at is not null
    or invitation.accepted_at is not null or invitation.expires_at<=now() then
    raise exception 'Invitation is unavailable; send a new invitation' using errcode='22023';
  end if;
  if invitation.sent_at is null then
    update beta_private.admin_invitations set sent_at=now() where id=invitation.id;
    perform beta_private.audit('admin.invitation_email_sent','admin_invitation',invitation.id::text,null,
      jsonb_build_object('userId',invitation.user_id));
  end if;
  return jsonb_build_object('sent',true);
end $$;

create function beta_private.admin_invitation_status(p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=beta_private.require_user(); invitation beta_private.admin_invitations;
begin
  select i.* into invitation from beta_private.admin_invitations i join auth.users target on target.id=i.user_id
  join public.profiles p on p.id=target.id
  where i.id=p_invitation_id and i.user_id=u and lower(target.email)=i.email
    and p.deleted_at is null and i.sent_at is not null and i.cancelled_at is null and i.expires_at>now()
    and exists(select 1 from beta_private.admin_role_managers m join auth.users super_user on super_user.id=m.user_id
      join public.user_roles r on r.user_id=m.user_id and r.role='admin'
      join public.profiles sp on sp.id=m.user_id
      where m.user_id=i.invited_by and lower(super_user.email)='tymabee@proton.me'
        and super_user.email_confirmed_at is not null and sp.deleted_at is null);
  if invitation.id is null then
    raise exception 'Invitation is unavailable for this account; sign in with the invited email or ask Ty for a new invitation' using errcode='42501';
  end if;
  return jsonb_build_object('invitationId',invitation.id,'expiresAt',invitation.expires_at,
    'accepted',invitation.accepted_at is not null);
end $$;

create function beta_private.admin_accept_invitation(p_invitation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=beta_private.require_user(); invitation beta_private.admin_invitations; audit_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('brock-admin-role-management',0));
  perform beta_private.admin_invitation_status(p_invitation_id);
  select * into invitation from beta_private.admin_invitations where id=p_invitation_id for update;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2'
    or not exists(select 1 from auth.mfa_factors where user_id=u and factor_type='totp' and status='verified')
    or not exists(select 1 from beta_private.account_eligibility_attestations where user_id=u) then
    raise exception 'Verify your authenticator and confirm account eligibility before accepting' using errcode='42501';
  end if;
  if invitation.accepted_at is not null then
    return jsonb_build_object('enabled',exists(select 1 from public.user_roles where user_id=u and role='admin'));
  end if;
  insert into public.user_roles(user_id,role,granted_by) values(u,'admin',invitation.invited_by) on conflict do nothing;
  update beta_private.admin_invitations set accepted_at=now() where id=invitation.id;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_state,after_state)
  values(u,'admin.invitation_accepted','profile',u::text,jsonb_build_object('admin',false),
    jsonb_build_object('admin',true,'invitationId',invitation.id,'grantedBy',invitation.invited_by,'reason',invitation.reason))
  returning id into audit_id;
  return jsonb_build_object('enabled',true,'auditId',audit_id);
end $$;

-- Replace the previous direct grant command with revocation only. Acceptance is
-- the sole application path to a new staff grant, after the recipient's AAL2.
create or replace function beta_private.admin_set_account_role(
  p_user_id uuid,p_enabled boolean,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous jsonb; was_admin boolean; audit_id bigint; result jsonb;
begin
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Super administrator MFA access required' using errcode='42501';
  end if;
  if p_enabled is distinct from false then
    raise exception 'Send an admin invitation; direct grants are disabled' using errcode='42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then
    raise exception 'An audit reason of 8 to 500 characters is required' using errcode='22023';
  end if;
  previous:=beta_private.begin_command('admin_set_account_role',p_idempotency_key);
  if previous is not null then return previous; end if;
  perform pg_advisory_xact_lock(hashtextextended('brock-admin-role-management',0));
  if not exists(select 1 from public.profiles where id=p_user_id and deleted_at is null) then
    raise exception 'Active account required' using errcode='22023';
  end if;
  if p_user_id=auth.uid() or exists(select 1 from beta_private.admin_role_managers where user_id=p_user_id) then
    raise exception 'Protected super administrator access cannot be revoked here' using errcode='42501';
  end if;
  select exists(select 1 from public.user_roles where user_id=p_user_id and role='admin') into was_admin;
  delete from public.user_roles where user_id=p_user_id and role='admin';
  update beta_private.admin_invitations set cancelled_at=now() where user_id=p_user_id and cancelled_at is null;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,before_state,after_state,request_id)
  values(auth.uid(),'admin.account_role_changed','profile',p_user_id::text,jsonb_build_object('admin',was_admin),
    jsonb_build_object('admin',false,'reason',btrim(p_reason),'changed',was_admin),p_idempotency_key) returning id into audit_id;
  result:=jsonb_build_object('userId',p_user_id,'enabled',false,'changed',was_admin,'auditId',audit_id);
  return beta_private.finish_command('admin_set_account_role',p_idempotency_key,result);
end $$;

create or replace function beta_private.admin_find_account(p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Super administrator MFA access required' using errcode='42501';
  end if;
  if p_email is null or char_length(btrim(p_email)) not between 3 and 320 then
    raise exception 'Valid account email required' using errcode='22023';
  end if;
  select jsonb_build_object('found',true,'id',u.id,'email',u.email,'displayName',p.display_name,
    'emailVerified',u.email_confirmed_at is not null,
    'eligible',exists(select 1 from beta_private.account_eligibility_attestations a where a.user_id=u.id),
    'totpEnrolled',exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status='verified'),
    'isAdmin',exists(select 1 from public.user_roles r where r.user_id=u.id and r.role='admin'),
    'protectedOperator',exists(select 1 from beta_private.admin_role_managers m where m.user_id=u.id),
    'invitationPending',exists(select 1 from beta_private.admin_invitations i where i.user_id=u.id
      and i.accepted_at is null and i.cancelled_at is null and i.expires_at>now()))
  into result from auth.users u join public.profiles p on p.id=u.id
  where lower(u.email)=lower(btrim(p_email)) and p.deleted_at is null;
  return coalesce(result,jsonb_build_object('found',false));
end $$;

create function public.admin_create_invitation(p_email text,p_reason text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$
  select beta_private.admin_create_invitation(p_email,p_reason,p_idempotency_key); $$;
create function public.admin_mark_invitation_sent(p_invitation_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select beta_private.admin_mark_invitation_sent(p_invitation_id); $$;
create function public.admin_invitation_status(p_invitation_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select beta_private.admin_invitation_status(p_invitation_id); $$;
create function public.admin_accept_invitation(p_invitation_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select beta_private.admin_accept_invitation(p_invitation_id); $$;
revoke all on function beta_private.admin_create_invitation(text,text,text),
  beta_private.admin_mark_invitation_sent(uuid),beta_private.admin_invitation_status(uuid),
  beta_private.admin_accept_invitation(uuid),public.admin_create_invitation(text,text,text),
  public.admin_mark_invitation_sent(uuid),public.admin_invitation_status(uuid),public.admin_accept_invitation(uuid)
from public,anon,authenticated,service_role;
grant execute on function beta_private.admin_create_invitation(text,text,text),
  beta_private.admin_mark_invitation_sent(uuid),beta_private.admin_invitation_status(uuid),
  beta_private.admin_accept_invitation(uuid),public.admin_create_invitation(text,text,text),
  public.admin_mark_invitation_sent(uuid),public.admin_invitation_status(uuid),public.admin_accept_invitation(uuid)
to authenticated;
