-- The association deployment receives only this role's pooler credential.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='prelaunch_owner') then create role prelaunch_owner nologin; end if;
  if not exists(select 1 from pg_roles where rolname='prelaunch_api') then create role prelaunch_api login; end if;
end $$;
grant prelaunch_owner to postgres;
grant prelaunch_api to postgres;
create schema registration_private authorization prelaunch_owner;
revoke all on schema registration_private from public,anon,authenticated,service_role;
grant usage on schema registration_private to prelaunch_api;
grant usage on schema beta_private to prelaunch_owner;
grant select on beta_private.launch_state to prelaunch_owner;
grant update(singleton) on beta_private.launch_state to prelaunch_owner;
-- A narrow owner policy, not a blanket grant to the public API login.
create policy registration_owner_launch_read on beta_private.launch_state for select to prelaunch_owner using(true);
create policy registration_owner_launch_lock on beta_private.launch_state for update to prelaunch_owner using(true) with check(true);
grant execute on function public.consume_rate_limit(text,integer,integer) to prelaunch_api;

create table registration_private.registrations (
  id uuid primary key default gen_random_uuid(),
  email text unique check(email=lower(btrim(email)) and char_length(email) between 3 and 320),
  name text check(char_length(name) between 1 and 80),
  enrolled_at timestamptz not null default now(),
  state text not null default 'pending' check(state in ('pending','subscribed','unsubscribed','closed')),
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  activated_user_id uuid,
  last_development_sent_at timestamptz
);
create table registration_private.consent_events (
  id bigint generated always as identity primary key,
  registration_id uuid not null references registration_private.registrations(id) on delete cascade,
  event text not null check(event in ('enrolled','confirmed','withdrawn','closed')),
  purpose text not null default 'development_updates' check(purpose='development_updates'),
  copy_version text not null check(char_length(copy_version) between 1 and 100),
  created_at timestamptz not null default now()
);
create table registration_private.signup_receipts (
  token_hash bytea primary key check(octet_length(token_hash)=32),
  registration_id uuid not null references registration_private.registrations(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes'
);
create table registration_private.email_tokens (
  token_hash bytea primary key check(octet_length(token_hash)=32),
  registration_id uuid not null references registration_private.registrations(id) on delete cascade,
  purpose text not null check(purpose in ('confirm','unsubscribe')),
  copy_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  consumed_at timestamptz
);
create table registration_private.verification_jobs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registration_private.registrations(id) on delete cascade,
  -- AES-GCM ciphertext, not a plaintext capability. Only B has the encryption key.
  confirm_hash bytea not null references registration_private.email_tokens(token_hash) on delete cascade,
  encrypted_tokens text not null check(char_length(encrypted_tokens) between 100 and 2000),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz,
  lease_until timestamptz
);
create index receipt_expiration on registration_private.signup_receipts(expires_at);
create index token_registration on registration_private.email_tokens(registration_id);
create index consent_registration on registration_private.consent_events(registration_id,created_at);
create index verification_pending on registration_private.verification_jobs(next_attempt_at) where sent_at is null;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='registration_private' loop
    execute format('alter table registration_private.%I owner to prelaunch_owner',t.tablename);
    execute format('alter table registration_private.%I enable row level security',t.tablename);
    execute format('revoke all on registration_private.%I from public,anon,authenticated,service_role,prelaunch_api',t.tablename);
  end loop;
end $$;

create function registration_private.enroll(p_email text,p_name text,p_version text,p_receipt bytea,
  p_confirm bytea,p_unsubscribe bytea,p_encrypted_tokens text,p_queue_email boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r registration_private.registrations; begin
  -- SHARE lock makes the launch transition wait for in-flight intake transactions.
  perform 1 from beta_private.launch_state where singleton and phase='prelaunch' for share;
  if not found then raise exception 'Development enrollment is closed' using errcode='P0001'; end if;
  if p_email is null or p_email<>lower(btrim(p_email)) or char_length(p_email) not between 3 and 320
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (p_name is not null and char_length(p_name) not between 1 and 80)
    or p_version is null or char_length(p_version) not between 1 and 100
    or p_receipt is null or p_confirm is null or p_unsubscribe is null
    or octet_length(p_receipt)<>32 or octet_length(p_confirm)<>32 or octet_length(p_unsubscribe)<>32
    or p_encrypted_tokens is null or p_queue_email is null then raise exception 'Invalid enrollment' using errcode='22023'; end if;
  insert into registration_private.registrations(email,name) values(p_email,p_name)
    on conflict(email) do nothing;
  select * into strict r from registration_private.registrations where email=p_email for update;
  insert into registration_private.signup_receipts(token_hash,registration_id) values(p_receipt,r.id);
  insert into registration_private.consent_events(registration_id,event,copy_version) values(r.id,'enrolled',p_version);
  -- Preserve verified details and withdrawal. A fresh consent is applied only after owner confirmation.
  if p_queue_email and r.state in ('pending','unsubscribed') then
    insert into registration_private.email_tokens(token_hash,registration_id,purpose,copy_version,expires_at)
      values(p_confirm,r.id,'confirm',p_version,now()+interval '48 hours'),
            (p_unsubscribe,r.id,'unsubscribe',p_version,null);
    insert into registration_private.verification_jobs(registration_id,confirm_hash,encrypted_tokens) values(r.id,p_confirm,p_encrypted_tokens);
  end if;
end $$;

create function registration_private.receipt_valid(p_hash bytea) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from registration_private.signup_receipts where token_hash=p_hash and expires_at>now());
$$;
create function registration_private.token_valid(p_hash bytea,p_purpose text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from registration_private.email_tokens where token_hash=p_hash and purpose=p_purpose
    and consumed_at is null and (expires_at is null or expires_at>now()));
$$;
create function registration_private.apply_email_token(p_hash bytea,p_purpose text) returns boolean
language plpgsql security definer set search_path='' as $$
declare t registration_private.email_tokens; begin
  if p_purpose not in ('confirm','unsubscribe') then return false; end if;
  select * into t from registration_private.email_tokens where token_hash=p_hash and purpose=p_purpose
    and consumed_at is null and (expires_at is null or expires_at>now());
  if not found then return false; end if;
  perform 1 from registration_private.registrations where id=t.registration_id for update;
  select * into t from registration_private.email_tokens where token_hash=p_hash and purpose=p_purpose
    and consumed_at is null and (expires_at is null or expires_at>now()) for update;
  if not found then return false; end if;
  if p_purpose='confirm' then
    perform 1 from beta_private.launch_state where singleton and phase='prelaunch' for share;
    if not found then return false; end if;
    -- Serialize with withdrawal and invalidate older confirmation links on either transition.
    perform 1 from registration_private.registrations where id=t.registration_id for update;
    update registration_private.registrations set state='subscribed',confirmed_at=now(),withdrawn_at=null where id=t.registration_id;
  else
    perform 1 from registration_private.registrations where id=t.registration_id for update;
    update registration_private.registrations set state='unsubscribed',withdrawn_at=now() where id=t.registration_id;
  end if;
  update registration_private.email_tokens set consumed_at=now()
    where registration_id=t.registration_id and purpose='confirm' and consumed_at is null;
  if p_purpose='unsubscribe' then
    -- Keep unsubscribe links valid/repeatable for the life of the subscription record.
    delete from registration_private.verification_jobs where registration_id=t.registration_id and sent_at is null;
  end if;
  insert into registration_private.consent_events(registration_id,event,copy_version)
    values(t.registration_id,case when p_purpose='confirm' then 'confirmed' else 'withdrawn' end,t.copy_version);
  return true;
end $$;

create function registration_private.lease_verifications(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  if not exists(select 1 from beta_private.launch_state where singleton and phase='prelaunch') then return '[]'::jsonb; end if;
  with due as (
    select j.id from registration_private.verification_jobs j
    join registration_private.registrations r on r.id=j.registration_id
    where j.sent_at is null and j.attempts<5 and j.next_attempt_at<=now()
      and (j.lease_until is null or j.lease_until<now())
      and j.created_at>now()-interval '48 hours' and r.state in ('pending','unsubscribed')
      and exists(select 1 from registration_private.email_tokens t where t.registration_id=r.id
        and t.token_hash=j.confirm_hash and t.purpose='confirm' and t.consumed_at is null and t.expires_at>now())
    order by j.created_at limit least(greatest(p_limit,1),20) for update of j skip locked
  ), leased as (
    update registration_private.verification_jobs j set lease_until=now()+interval '5 minutes',attempts=attempts+1
    from due where j.id=due.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'email',r.email,'encryptedTokens',j.encrypted_tokens)),'[]'::jsonb)
    into result from leased j join registration_private.registrations r on r.id=j.registration_id;
  return result;
end $$;
create function registration_private.verification_sendable(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from registration_private.verification_jobs j
    join registration_private.email_tokens t on t.token_hash=j.confirm_hash
    join beta_private.launch_state l on l.singleton
    where j.id=p_id and j.sent_at is null and t.consumed_at is null and t.expires_at>now() and l.phase='prelaunch');
$$;
create function registration_private.finish_verification(p_id uuid,p_sent boolean) returns void
language sql security definer set search_path='' as $$
  update registration_private.verification_jobs set sent_at=case when p_sent then now() end,
    lease_until=null,next_attempt_at=now()+interval '30 minutes' where id=p_id and sent_at is null;
$$;
create function registration_private.development_open() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from beta_private.launch_state where singleton and phase='prelaunch');
$$;
create function registration_private.maintenance() returns void
language plpgsql security definer set search_path='' as $$ begin
  delete from registration_private.signup_receipts where expires_at<now();
  delete from registration_private.email_tokens where expires_at<now()-interval '24 hours';
  delete from registration_private.verification_jobs where created_at<now()-interval '7 days';
  if not exists(select 1 from beta_private.launch_state where singleton and phase='prelaunch') then
    insert into registration_private.consent_events(registration_id,event,copy_version)
      select id,'closed','development-purpose-closed-at-launch' from registration_private.registrations where state in ('pending','subscribed');
    update registration_private.registrations set state='closed' where state in ('pending','subscribed');
    delete from registration_private.verification_jobs where sent_at is null;
    delete from registration_private.email_tokens where registration_id in (
      select r.id from registration_private.registrations r,beta_private.launch_state l
      where l.singleton and r.activated_user_id is null and l.launched_at<now()-interval '12 months');
    update registration_private.registrations r set email=null,name=null
      from beta_private.launch_state l where l.singleton and r.activated_user_id is null
      and l.launched_at<now()-interval '12 months';
    delete from registration_private.registrations r using beta_private.launch_state l
      where l.singleton and r.activated_user_id is null
      and greatest(l.launched_at,coalesce(r.last_development_sent_at,r.enrolled_at))<now()-interval '24 months';
  end if;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='registration_private' loop
    execute format('alter function %s owner to prelaunch_owner',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    execute format('grant execute on function %s to prelaunch_api',f.signature);
  end loop;
end $$;
alter default privileges for role prelaunch_owner in schema registration_private revoke all on tables from public,anon,authenticated,service_role,prelaunch_api;
alter default privileges for role prelaunch_owner revoke execute on functions from public;
