-- Public accounts are independent of application access. Preserve legacy approvals
-- as audit evidence, but they no longer authorize any application operation.
create or replace function rpc_private.can_use_app() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    join public.user_roles r on r.user_id=u.id and r.role='admin'
    where u.id=auth.uid() and u.email_confirmed_at is not null and p.deleted_at is null
      and exists(select 1 from auth.sessions s where s.user_id=u.id
        and s.id::text=auth.jwt()->>'session_id'));
$$;
create function rpc_private.is_admin_account_email(p_email text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join public.profiles p on p.id=u.id
    join public.user_roles r on r.user_id=u.id and r.role='admin'
    where lower(btrim(u.email))=lower(btrim(p_email)) and p.deleted_at is null);
$$;
create function public.is_admin_account_email(p_email text) returns boolean
language sql stable security invoker set search_path='' as $$
  select rpc_private.is_admin_account_email(p_email);
$$;
revoke all on function rpc_private.is_admin_account_email(text),public.is_admin_account_email(text) from public,anon,authenticated;
grant execute on function rpc_private.is_admin_account_email(text),public.is_admin_account_email(text) to service_role;
revoke all on function public.is_approved_tester_email(text),public.admin_beta_testers(text,boolean,text),
  beta_private.admin_beta_testers(text,boolean,text) from public,anon,authenticated,service_role;
drop trigger bind_approved_identity on auth.users;
create or replace function beta_private.before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ begin return '{}'::jsonb; end $$;

-- Invitation-specific RPCs already enforce verified identity, expiry and MFA.
-- Invitees may complete those checks without gaining general application access.
create or replace function public.admin_invitation_status(p_invitation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select beta_private.admin_invitation_status(p_invitation_id); $$;
create or replace function public.admin_accept_invitation(p_invitation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select beta_private.admin_accept_invitation(p_invitation_id); $$;

create table registration_private.account_signup_handoffs (
  token_hash bytea primary key check(octet_length(token_hash)=32),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes'
);
create table registration_private.account_signup_receipts (
  token_hash bytea primary key check(octet_length(token_hash)=32),
  user_id uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table registration_private.news_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null unique check(email=lower(btrim(email))),
  state text not null default 'pending' check(state in ('pending','subscribed','unsubscribed')),
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);
create table registration_private.news_consent_events (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references registration_private.news_subscriptions(id) on delete cascade,
  event text not null check(event in ('requested','confirmed','withdrawn')),
  purpose text not null default 'launch_and_sports_news' check(purpose='launch_and_sports_news'),
  copy_version text not null,
  created_at timestamptz not null default now()
);
create table registration_private.news_unsubscribe_tokens (
  token_hash bytea primary key check(octet_length(token_hash)=32),
  subscription_id uuid not null references registration_private.news_subscriptions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index account_handoff_expiry on registration_private.account_signup_handoffs(expires_at);
create index account_receipt_expiry on registration_private.account_signup_receipts(expires_at);
create index news_subscription_user on registration_private.news_subscriptions(user_id);
create index news_consent_subscription on registration_private.news_consent_events(subscription_id,created_at);
do $$ declare t text; begin
  foreach t in array array['account_signup_handoffs','account_signup_receipts','news_subscriptions','news_consent_events','news_unsubscribe_tokens'] loop
    execute format('alter table registration_private.%I enable row level security',t);
    execute format('revoke all on registration_private.%I from public,anon,authenticated,service_role,prelaunch_api',t);
  end loop;
end $$;

create function rpc_private.issue_account_signup_handoff(p_user_id uuid,p_email text,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare linked uuid; begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid receipt' using errcode='22023'; end if;
  select id into linked from auth.users where id=p_user_id and lower(btrim(email))=lower(btrim(p_email));
  -- Supabase can return an obfuscated identity for a duplicate signup. A generic
  -- receipt may show confirmation copy, but never changes that account's consent.
  insert into registration_private.account_signup_handoffs(token_hash,user_id) values(decode(p_hash,'hex'),linked);
end $$;
create function public.issue_account_signup_handoff(p_user_id uuid,p_email text,p_hash text) returns void
language sql security invoker set search_path='' as $$
  select rpc_private.issue_account_signup_handoff(p_user_id,p_email,p_hash);
$$;
revoke all on function rpc_private.issue_account_signup_handoff(uuid,text,text),public.issue_account_signup_handoff(uuid,text,text) from public,anon,authenticated;
grant execute on function rpc_private.issue_account_signup_handoff(uuid,text,text),public.issue_account_signup_handoff(uuid,text,text) to service_role;

create function registration_private.complete_account_signup(p_ticket bytea,p_receipt bytea) returns boolean
language plpgsql security definer set search_path='' as $$
declare r registration_private.account_signup_handoffs; begin
  if p_receipt is null or octet_length(p_receipt)<>32 then return false; end if;
  delete from registration_private.account_signup_handoffs where token_hash=p_ticket and expires_at>now() returning * into r;
  if not found then return false; end if;
  insert into registration_private.account_signup_receipts(token_hash,user_id,expires_at) values(p_receipt,r.user_id,r.expires_at);
  return true;
end $$;
create function registration_private.account_receipt_status(p_hash bytea) returns text
language sql stable security definer set search_path='' as $$
  select case when r.user_id is null then 'generic'
    when s.state='subscribed' then 'subscribed' when s.state='pending' then 'pending'
    when s.state='unsubscribed' then 'unsubscribed' else 'account' end
  from registration_private.account_signup_receipts r
  left join auth.users u on u.id=r.user_id
  left join registration_private.news_subscriptions s on s.user_id=r.user_id and s.email=lower(btrim(u.email))
  where r.token_hash=p_hash and r.expires_at>now();
$$;
create function registration_private.set_account_news_consent(p_hash bytea,p_enabled boolean,p_version text,p_unsubscribe bytea) returns boolean
language plpgsql security definer set search_path='' as $$
declare r registration_private.account_signup_receipts; u auth.users; s registration_private.news_subscriptions; begin
  select * into r from registration_private.account_signup_receipts where token_hash=p_hash and expires_at>now();
  if not found or r.user_id is null then return false; end if;
  select * into u from auth.users where id=r.user_id;
  if not found or u.email is null then return false; end if;
  if p_enabled is null or p_version is null or char_length(p_version) not between 1 and 100
    or p_unsubscribe is null or octet_length(p_unsubscribe)<>32 then return false; end if;
  if p_enabled then
    insert into registration_private.news_subscriptions(user_id,email) values(u.id,lower(btrim(u.email))) on conflict(email) do nothing;
  end if;
  select * into s from registration_private.news_subscriptions where user_id=u.id and email=lower(btrim(u.email)) for update;
  if not found then return false; end if;
  -- A receipt is registration proof, not email ownership. Withdrawal cannot be
  -- reversed by a duplicate signup or by editing profile/user metadata.
  if p_enabled and s.state='unsubscribed' then return false; end if;
  update registration_private.news_subscriptions set state=case when not p_enabled then 'unsubscribed'
    when u.email_confirmed_at is not null then 'subscribed' else 'pending' end,
    confirmed_at=case when p_enabled and u.email_confirmed_at is not null then coalesce(confirmed_at,now()) else confirmed_at end,
    withdrawn_at=case when not p_enabled then now() else withdrawn_at end where id=s.id;
  insert into registration_private.news_consent_events(subscription_id,event,copy_version)
    values(s.id,case when p_enabled then 'requested' else 'withdrawn' end,p_version);
  if p_enabled and u.email_confirmed_at is not null then
    insert into registration_private.news_consent_events(subscription_id,event,copy_version) values(s.id,'confirmed',p_version);
  end if;
  if p_enabled then insert into registration_private.news_unsubscribe_tokens(token_hash,subscription_id) values(p_unsubscribe,s.id); end if;
  return true;
end $$;
create function registration_private.confirm_account_news() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  if new.email_confirmed_at is not null then
    with changed as (
      update registration_private.news_subscriptions set state='subscribed',confirmed_at=now()
      where user_id=new.id and email=lower(btrim(new.email)) and state='pending' returning id
    ) insert into registration_private.news_consent_events(subscription_id,event,copy_version)
      select id,'confirmed','launch-sports-news-2026-10-09.1' from changed;
  end if;
  if old.email is distinct from new.email then
    with changed as (
      update registration_private.news_subscriptions set state='unsubscribed',withdrawn_at=now()
      where user_id=new.id and email<>lower(btrim(new.email)) and state<>'unsubscribed' returning id
    ) insert into registration_private.news_consent_events(subscription_id,event,copy_version)
      select id,'withdrawn','account-email-change' from changed;
  end if;
  return new;
end $$;
revoke all on function registration_private.confirm_account_news() from public,anon,authenticated,service_role,prelaunch_api;
create trigger confirm_account_news after update of email_confirmed_at,email on auth.users for each row execute function registration_private.confirm_account_news();
create function registration_private.news_unsubscribe(p_hash bytea,p_apply boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare target uuid; begin
  select subscription_id into target from registration_private.news_unsubscribe_tokens where token_hash=p_hash;
  if not found then return false; end if;
  if p_apply then
    update registration_private.news_subscriptions set state='unsubscribed',withdrawn_at=now() where id=target;
    insert into registration_private.news_consent_events(subscription_id,event,copy_version) values(target,'withdrawn','launch-sports-news-2026-10-09.1');
  end if;
  return true;
end $$;
create function registration_private.account_news_cleanup() returns void
language sql security definer set search_path='' as $$
  delete from registration_private.account_signup_handoffs where expires_at<now();
  delete from registration_private.account_signup_receipts where expires_at<now();
$$;
grant usage on schema registration_private to service_role;
do $$ declare f regprocedure; begin
  foreach f in array array['registration_private.complete_account_signup(bytea,bytea)'::regprocedure,
    'registration_private.account_receipt_status(bytea)'::regprocedure,
    'registration_private.set_account_news_consent(bytea,boolean,text,bytea)'::regprocedure,
    'registration_private.news_unsubscribe(bytea,boolean)'::regprocedure,
    'registration_private.account_news_cleanup()'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
    execute format('grant execute on function %s to prelaunch_api',f);
  end loop;
end $$;
notify pgrst,'reload schema';
