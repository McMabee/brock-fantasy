-- Additive access boundary. No existing account, profile, or league is replaced.
create table beta_private.launch_state (
  singleton boolean primary key default true check(singleton),
  phase text not null default 'prelaunch' check(phase in ('prelaunch','public')),
  launched_at timestamptz,
  check((phase='prelaunch' and launched_at is null) or (phase='public' and launched_at is not null))
);
insert into beta_private.launch_state(singleton) values(true);
create table beta_private.application_access (
  email text primary key check(email=lower(btrim(email)) and char_length(email) between 3 and 320),
  user_id uuid unique references auth.users(id) on delete set null,
  access_kind text not null default 'tester' check(access_kind in ('tester','operator')),
  approved_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  reason text not null check(char_length(reason) between 8 and 500),
  revoked_at timestamptz,
  public_activated_at timestamptz,
  disabled_at timestamptz,
  identity_bound_at timestamptz
);
alter table beta_private.launch_state enable row level security;
alter table beta_private.application_access enable row level security;
revoke all on beta_private.launch_state,beta_private.application_access from public,anon,authenticated,service_role;

insert into beta_private.application_access(email,reason)
values ('gt22me@brocku.ca','Initial tester approved by project owner on 2026-10-09'),
       ('ethan.greatorex1245@gmail.com','Initial tester approved by project owner on 2026-10-09'),
       ('ci22wd@brocku.ca','Nicholas Zadravec approved as tester by project owner on 2026-10-09');
insert into beta_private.application_access(email,access_kind,reason)
values ('tymabee@proton.me','operator','Initial tester and existing super administrator approved by project owner on 2026-10-09');
do $$ begin
  if exists(select 1 from auth.users u
    where lower(btrim(u.email)) in (select email from beta_private.application_access)
    group by lower(btrim(u.email)) having count(*)>1) then
    raise exception 'Ambiguous approved Auth identity; resolve normalized email duplicates before migration';
  end if;
end $$;
update beta_private.application_access a set user_id=u.id,identity_bound_at=now()
from auth.users u where lower(btrim(u.email))=a.email;
-- Retain the previously authorized super administrator as an operator, not a tester.
insert into beta_private.application_access(email,user_id,access_kind,reason,identity_bound_at)
select lower(btrim(u.email)),u.id,'operator','Preserved existing protected operator authority',now()
from beta_private.admin_role_managers m join auth.users u on u.id=m.user_id
where u.email_confirmed_at is not null on conflict(email) do nothing;

-- Nicholas was explicitly requested as a regular admin. Preserve the existing
-- verified-email, eligibility and enrolled-TOTP requirements for staff grants.
-- Missing prerequisites require the protected admin invitation flow before rollout.
with inserted as (
  insert into public.user_roles(user_id,role)
  select u.id,'admin' from auth.users u join public.profiles p on p.id=u.id
  where lower(btrim(u.email))='ci22wd@brocku.ca' and u.email_confirmed_at is not null
    and p.deleted_at is null
    and exists(select 1 from beta_private.account_eligibility_attestations e where e.user_id=u.id)
    and exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.factor_type='totp' and f.status='verified')
  on conflict do nothing returning user_id
)
insert into public.audit_log(action,entity_type,entity_id,after_state)
select 'admin.initial_approval','profile',user_id::text,
  jsonb_build_object('role','admin','source','explicit-nicholas-approval-2026-10-09') from inserted;

create function rpc_private.can_use_app() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from beta_private.application_access a
    join auth.users u on u.id=a.user_id
    join public.profiles p on p.id=u.id
    join beta_private.launch_state l on l.singleton
    where u.id=auth.uid() and u.email_confirmed_at is not null and p.deleted_at is null
      and a.email=lower(btrim(u.email)) and a.disabled_at is null
      and ((l.phase='prelaunch' and a.revoked_at is null)
        or (l.phase='public' and a.public_activated_at is not null))
      and exists(select 1 from auth.sessions s where s.user_id=u.id
        and s.id::text=auth.jwt()->>'session_id')
  );
$$;
create function public.can_use_app() returns boolean language sql stable security invoker
set search_path='' as $$ select rpc_private.can_use_app(); $$;
revoke all on function rpc_private.can_use_app(),public.can_use_app() from public,anon,authenticated,service_role;
grant execute on function rpc_private.can_use_app(),public.can_use_app() to anon,authenticated,service_role;

create function rpc_private.require_app_access() returns void language plpgsql stable security definer
set search_path='' as $$ begin
  if auth.role()='service_role' then return; end if;
  if not rpc_private.can_use_app() then
    raise exception 'Application access required' using errcode='42501';
  end if;
end $$;
revoke all on function rpc_private.require_app_access() from public,anon,authenticated,service_role;
grant execute on function rpc_private.require_app_access() to authenticated,service_role;

create function public.is_approved_tester_email(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from beta_private.application_access a
    where a.email=lower(btrim(p_email)) and a.revoked_at is null and a.disabled_at is null
      and (a.user_id is not null or a.identity_bound_at is null));
$$;
revoke all on function public.is_approved_tester_email(text) from public,anon,authenticated,service_role;
grant execute on function public.is_approved_tester_email(text) to service_role;

-- Restrictive policies are ANDed with existing ownership/league policies.
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
  loop
    execute format('create policy application_access_required on public.%I as restrictive for all to anon,authenticated using ((select public.can_use_app())) with check ((select public.can_use_app()))',t.relname);
  end loop;
end $$;

-- Guard the exposed invoker wrappers, including old commands that predate require_user.
-- Existing implementations, OIDs, signatures, defaults and worker grants stay intact.
do $$ declare f record; target text; call_args text; body text; begin
  for f in select p.*,pg_get_function_arguments(p.oid) args,pg_get_function_result(p.oid) result
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and not p.prosecdef
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.proname not in ('can_use_app')
      and (p.prosrc like '%rpc_private.%' or p.prosrc like '%beta_private.%')
  loop
    target:=case when f.prosrc like '%rpc_private.%' then 'rpc_private' else 'beta_private' end;
    select coalesce(string_agg('$'||i::text,', ' order by i),'') into call_args from generate_series(1,f.pronargs) i;
    body:=format('begin perform rpc_private.require_app_access(); %s %I.%I(%s); %s end',
      case when f.proretset then 'return query select * from' when f.result='void' then 'perform' else 'return' end,
      target,f.proname,call_args,case when f.result='void' then 'return;' else '' end);
    execute format('create or replace function public.%I(%s) returns %s language plpgsql %s security invoker set search_path=%L as %L',
      f.proname,f.args,f.result,case when f.provolatile='s' then 'stable' else 'volatile' end,'',body);
  end loop;
end $$;

create function beta_private.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
  if not exists(select 1 from beta_private.application_access a
    where a.email=lower(btrim(event->'user'->>'email')) and a.revoked_at is null
      and a.disabled_at is null and a.user_id is null and a.identity_bound_at is null)
  then return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Private beta approval is required.')); end if;
  return '{}'::jsonb;
end $$;
revoke all on function beta_private.before_user_created(jsonb) from public,anon,authenticated,service_role;
grant usage on schema beta_private to supabase_auth_admin;
grant execute on function beta_private.before_user_created(jsonb) to supabase_auth_admin;

-- Also enforce approval at INSERT: this cannot be bypassed by an unconfigured Auth hook.
create function beta_private.bind_approved_identity() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  update beta_private.application_access set user_id=new.id,identity_bound_at=now()
  where email=lower(btrim(new.email)) and revoked_at is null and disabled_at is null
    and user_id is null and identity_bound_at is null;
  if not found then raise exception 'Private beta approval is required' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function beta_private.bind_approved_identity() from public,anon,authenticated,service_role;
create trigger bind_approved_identity after insert on auth.users
for each row execute function beta_private.bind_approved_identity();

create function beta_private.admin_beta_testers(p_email text default null,p_enabled boolean default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(btrim(p_email)); target_id uuid; before_value jsonb; begin
  perform rpc_private.require_app_access();
  if not beta_private.can_manage_admin_accounts() then
    raise exception 'Protected operator MFA access required' using errcode='42501'; end if;
  if p_enabled is not null then
    if normalized is null or char_length(normalized) not between 3 and 320 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then
      raise exception 'Email and an audit reason are required' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('beta-approval:'||normalized,0));
    select to_jsonb(a) into before_value from beta_private.application_access a where a.email=normalized;
    if exists(select 1 from beta_private.application_access where email=normalized and access_kind='operator') then
      raise exception 'Operator access is managed separately' using errcode='42501'; end if;
    if (select count(*) from auth.users where lower(btrim(email))=normalized)>1 then
      raise exception 'Ambiguous Auth identity requires operator review' using errcode='22023'; end if;
    select id into target_id from auth.users where lower(btrim(email))=normalized;
    if p_enabled then
      if exists(select 1 from beta_private.application_access where user_id=target_id and email<>normalized and access_kind='operator') then
        raise exception 'Operator identity changes require separate recovery' using errcode='42501'; end if;
      -- Approval of a changed email explicitly retires the old binding, without touching user roles.
      update beta_private.application_access set user_id=null,revoked_at=now(),reason='Identity email changed; explicitly reapproved under new email'
        where user_id=target_id and email<>normalized;
      insert into beta_private.application_access(email,user_id,approved_by,reason,identity_bound_at)
      values(normalized,target_id,auth.uid(),btrim(p_reason),case when target_id is not null then now() end)
      on conflict(email) do update set user_id=excluded.user_id,approved_at=now(),approved_by=auth.uid(),
        reason=excluded.reason,revoked_at=null,disabled_at=null,identity_bound_at=excluded.identity_bound_at;
    else
      update beta_private.application_access set revoked_at=now(),reason=btrim(p_reason) where email=normalized;
    end if;
    perform beta_private.audit(case when p_enabled then 'beta_access_approved' else 'beta_access_revoked' end,
      'application_access',normalized,before_value,
      (select to_jsonb(a) from beta_private.application_access a where a.email=normalized),null);
  end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.approved_at desc) from beta_private.application_access a),'[]'::jsonb);
end $$;
create function public.admin_beta_testers(p_email text default null,p_enabled boolean default null,p_reason text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select beta_private.admin_beta_testers(p_email,p_enabled,p_reason);
$$;
revoke all on function beta_private.admin_beta_testers(text,boolean,text),public.admin_beta_testers(text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function beta_private.admin_beta_testers(text,boolean,text),public.admin_beta_testers(text,boolean,text) to authenticated;
notify pgrst,'reload schema';
