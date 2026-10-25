set local lock_timeout='2s';
set local statement_timeout='30s';

-- - Keep release activation separate from schema installation and preserve current gameplay
create table beta_private.release_controls (
  singleton boolean primary key default true check(singleton),
  automatic_drafts_enabled boolean not null default false,
  mode_selection_required boolean not null default false,
  service_email_enabled boolean not null default false,
  retention_enabled boolean not null default false,
  policy_publication_approved boolean not null default false
);
insert into beta_private.release_controls default values;

create table beta_private.retention_holds (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  record_key text not null,
  reason text not null check(length(btrim(reason)) between 8 and 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(category,record_key)
);
create index retention_holds_expiry on beta_private.retention_holds(expires_at);
create index retention_holds_creator on beta_private.retention_holds(created_by)where created_by is not null;

create table beta_private.service_email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  draft_updates boolean not null default true,
  suppressed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table beta_private.service_email_jobs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null check(kind in('contact','draft','account')),
  user_id uuid references auth.users(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  payload jsonb not null default '{}',
  status text not null default 'queued' check(status in('queued','leased','accepted','delivered','failed','bounced','suppressed','obsolete')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_id text unique,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((kind in('draft','account') and user_id is not null and notification_id is not null) or kind='contact')
);
create index service_email_due on beta_private.service_email_jobs(next_attempt_at,id) where status in('queued','leased');
create index service_email_expiry on beta_private.service_email_jobs(created_at,id);
create index service_email_user on beta_private.service_email_jobs(user_id) where user_id is not null;
create index service_email_notification on beta_private.service_email_jobs(notification_id)where notification_id is not null;
create table beta_private.service_email_events(
  provider_id text not null,
  event text not null check(event in('delivered','bounced','complained')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(provider_id,event)
);
create index service_email_event_expiry on beta_private.service_email_events(created_at);
alter table beta_private.service_email_events enable row level security;
revoke all on beta_private.service_email_events from public,anon,authenticated,service_role;

alter table beta_private.release_controls enable row level security;
alter table beta_private.retention_holds enable row level security;
alter table beta_private.service_email_preferences enable row level security;
alter table beta_private.service_email_jobs enable row level security;
revoke all on beta_private.release_controls,beta_private.retention_holds,beta_private.service_email_preferences,beta_private.service_email_jobs from public,anon,authenticated,service_role;

create function beta_private.require_worker() returns void language plpgsql security invoker set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and not (
    session_user in('postgres','supabase_admin') and current_setting('role',true) in('none','postgres','supabase_admin')
  ) then raise exception 'Worker access required' using errcode='42501'; end if;
end;
$$;
revoke all on function beta_private.require_worker() from public,anon,authenticated,service_role;

create function rpc_private.get_service_email_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  return jsonb_build_object('draft_updates',coalesce((select draft_updates from beta_private.service_email_preferences where user_id=auth.uid()),true));
end;
$$;
create function rpc_private.set_service_email_preferences(p_draft_updates boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  if p_draft_updates is null then raise exception 'Choose a draft email preference' using errcode='22023'; end if;
  insert into beta_private.service_email_preferences(user_id,draft_updates)values(auth.uid(),p_draft_updates)
  on conflict(user_id)do update set draft_updates=excluded.draft_updates,updated_at=clock_timestamp();
  return jsonb_build_object('draft_updates',p_draft_updates);
end;
$$;
create function public.get_service_email_preferences() returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.get_service_email_preferences();$$;
create function public.set_service_email_preferences(p_draft_updates boolean) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.set_service_email_preferences(p_draft_updates);$$;
revoke all on function rpc_private.get_service_email_preferences(),rpc_private.set_service_email_preferences(boolean),public.get_service_email_preferences(),public.set_service_email_preferences(boolean) from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_service_email_preferences(),rpc_private.set_service_email_preferences(boolean),public.get_service_email_preferences(),public.set_service_email_preferences(boolean) to authenticated;

-- - The restricted association role can enqueue operator mail but cannot read recipients or jobs
create function beta_private.queue_contact_checked(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job beta_private.service_email_jobs%rowtype;
begin
  if not(select service_email_enabled from beta_private.release_controls)then raise exception 'Contact delivery is awaiting release checks'using errcode='55000';end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192
    or coalesce(p_payload->>'kind','') not in('contact','bug','suggestion')
    or length(btrim(coalesce(p_payload->>'message',''))) not between 1 and 5000
    or length(coalesce(p_payload->>'name',''))>100 or length(coalesce(p_payload->>'replyEmail',''))>320 or length(coalesce(p_payload->>'title',''))>150 or length(coalesce(p_payload->>'page',''))>2000
    or (coalesce(p_payload->>'replyEmail','')<>'' and (p_payload->>'replyEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or (p_payload->>'kind'='contact' and coalesce(p_payload->>'replyEmail','')='')
    or exists(select 1 from jsonb_object_keys(p_payload)k where k not in('kind','name','replyEmail','title','message','page'))
    then raise exception 'Enter a valid message and reply address' using errcode='22023'; end if;
  insert into beta_private.service_email_jobs(dedupe_key,kind,payload)values('contact:'||p_request_id,'contact',p_payload)
  on conflict(dedupe_key)do nothing;
  select * into job from beta_private.service_email_jobs where dedupe_key='contact:'||p_request_id;
  if job.payload<>p_payload then raise exception 'Request changed; use a new request ID' using errcode='PT409'; end if;
  return jsonb_build_object('id',job.id,'status',job.status);
end;
$$;
revoke all on function beta_private.queue_contact_checked(uuid,jsonb) from public,anon,authenticated,service_role;

create function beta_private.queue_contact_message(p_request_id uuid,p_payload jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$begin
  perform beta_private.require_worker(); return beta_private.queue_contact_checked(p_request_id,p_payload);
end;$$;
create function public.queue_contact_message(p_request_id uuid,p_payload jsonb)returns jsonb language sql security invoker set search_path='' as $$select beta_private.queue_contact_message(p_request_id,p_payload);$$;
create function registration_private.queue_contact_message(p_request_id uuid,p_payload jsonb)returns jsonb language sql security definer set search_path='' as $$select beta_private.queue_contact_checked(p_request_id,p_payload);$$;
revoke all on function registration_private.queue_contact_message(uuid,jsonb) from public,anon,authenticated,service_role;
do $$begin if exists(select 1 from pg_roles where rolname='prelaunch_api')then grant execute on function registration_private.queue_contact_message(uuid,jsonb)to prelaunch_api;end if;end$$;

create function beta_private.queue_draft_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind in('draft_schedule_changed','draft_reminder','draft_completed','draft_blocked','draft_automatic_paused') then
    insert into beta_private.service_email_jobs(dedupe_key,kind,user_id,notification_id)
    values('notification:'||new.id,'draft',new.user_id,new.id)on conflict do nothing;
  end if;
  if new.kind='account_inactivity'then
    insert into beta_private.service_email_jobs(dedupe_key,kind,user_id,notification_id)
    values('notification:'||new.id,'account',new.user_id,new.id)on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function beta_private.queue_draft_email() from public,anon,authenticated,service_role;
create trigger draft_service_email after insert on public.notifications for each row execute function beta_private.queue_draft_email();

create function beta_private.claim_service_email_jobs(p_limit integer default 20,p_job_id uuid default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; batch uuid:=gen_random_uuid();
begin
  perform beta_private.require_worker();
  if p_limit not between 1 and 25 then raise exception 'Invalid batch limit' using errcode='22023';end if;
  if not(select service_email_enabled from beta_private.release_controls)then return '[]';end if;
  -- - Never replay an uncertain send after the provider idempotency window expires
  update beta_private.service_email_jobs set status='failed',failure_code='delivery_window_expired',lease_token=null,lease_until=null
  where status in('queued','leased')and created_at<clock_timestamp()-interval '23 hours'and(lease_until is null or lease_until<=clock_timestamp());
  update beta_private.service_email_jobs set status='failed',lease_token=null,lease_until=null,failure_code='lease_attempts_exhausted'
  where status='leased'and lease_until<=clock_timestamp()and attempts>=5;
  with due as (
    select j.id from beta_private.service_email_jobs j
    where (p_job_id is null or j.id=p_job_id) and j.status in('queued','leased') and j.attempts<5
      and j.created_at>=clock_timestamp()-interval '23 hours'and j.next_attempt_at<=clock_timestamp() and (j.lease_until is null or j.lease_until<=clock_timestamp())
    order by j.next_attempt_at,j.id limit p_limit for update skip locked
  )update beta_private.service_email_jobs j set status='leased',lease_token=batch,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp()
   from due where j.id=due.id;
  update beta_private.service_email_jobs j set status='suppressed',lease_until=null,lease_token=null
  where j.status='leased' and j.kind in('draft','account') and (
    not exists(select 1 from auth.users u where u.id=j.user_id and u.email_confirmed_at is not null)
    or exists(select 1 from beta_private.service_email_preferences p where p.user_id=j.user_id and((j.kind='draft'and not p.draft_updates)or p.suppressed))
    or exists(select 1 from public.notifications n where n.id=j.notification_id and n.data->>'obsolete'='true')
  );
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'leaseToken',j.lease_token,'attempts',j.attempts,'userId',j.user_id,
    'email',u.email,'payload',case when j.kind='contact'then j.payload else jsonb_build_object('kind',n.kind,'title',n.title,'body',n.body,'data',n.data)end)),'[]')into result
  from beta_private.service_email_jobs j left join auth.users u on u.id=j.user_id left join public.notifications n on n.id=j.notification_id
  where j.status='leased' and j.lease_until>clock_timestamp() and j.lease_token=batch;
  return result;
end;
$$;

create function beta_private.finish_service_email_job(p_job_id uuid,p_lease_token uuid,p_status text,p_provider_id text default null,p_failure_code text default null)returns boolean
language plpgsql security definer set search_path='' as $$
declare j beta_private.service_email_jobs%rowtype;event_record record;
begin
  perform beta_private.require_worker();
  if p_status not in('accepted','retry','failed','obsolete') or length(coalesce(p_failure_code,''))>80 then raise exception 'Invalid delivery outcome' using errcode='22023';end if;
  select * into j from beta_private.service_email_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'leased' or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp()then return false;end if;
  update beta_private.service_email_jobs set status=case when p_status='retry'and attempts<5 then 'queued'when p_status='retry'then'failed'else p_status end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^attempts)::integer)),provider_id=p_provider_id,
    failure_code=p_failure_code,lease_token=null,lease_until=null,updated_at=clock_timestamp()where id=j.id;
  if p_status='accepted'then
    for event_record in select event from beta_private.service_email_events where provider_id=p_provider_id order by case when event='delivered'then 0 else 1 end loop
      perform beta_private.record_service_email_event(p_provider_id,event_record.event);
    end loop;
  end if;
  return true;
end;
$$;

create function beta_private.record_service_email_event(p_provider_id text,p_event text)returns boolean
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  perform beta_private.require_worker();
  if p_event not in('delivered','bounced','complained')or length(coalesce(p_provider_id,''))not between 1 and 128 then raise exception 'Unsupported delivery event' using errcode='22023';end if;
  -- - Retain an early webhook until its provider acceptance is durably acknowledged
  insert into beta_private.service_email_events(provider_id,event)values(p_provider_id,p_event)on conflict do nothing;
  update beta_private.service_email_jobs set status=case when p_event='complained'then'bounced'else p_event end,updated_at=clock_timestamp()
  where provider_id=p_provider_id and status in('accepted','delivered')returning user_id into target;
  if p_event in('bounced','complained')and target is not null then
    insert into beta_private.service_email_preferences(user_id,suppressed)values(target,true)
    on conflict(user_id)do update set suppressed=true,updated_at=clock_timestamp();
  end if;
  return true;
end;
$$;
create function beta_private.suppress_draft_email(p_user_id uuid)returns void language plpgsql security definer set search_path='' as $$begin
  perform beta_private.require_worker();
  if not exists(select 1 from auth.users where id=p_user_id)then return;end if;
  insert into beta_private.service_email_preferences(user_id,draft_updates)values(p_user_id,false)
  on conflict(user_id)do update set draft_updates=false,updated_at=clock_timestamp();
end;$$;

create function beta_private.service_email_sendable(p_job_id uuid,p_lease_token uuid)returns boolean
language plpgsql stable security definer set search_path=''as $$begin
  perform beta_private.require_worker();
  return exists(select 1 from beta_private.service_email_jobs j
    left join public.notifications n on n.id=j.notification_id
    left join public.leagues l on l.id::text=n.data->>'league_id'
    where j.id=p_job_id and j.status='leased'and j.lease_token=p_lease_token and j.lease_until>clock_timestamp()
    and(j.kind='contact'or(j.kind='account'and exists(select 1 from auth.users u where u.id=j.user_id and u.email_confirmed_at is not null)
      and not exists(select 1 from beta_private.service_email_preferences p where p.user_id=j.user_id and p.suppressed))or(j.kind='draft'and(
      exists(select 1 from auth.users u where u.id=j.user_id and u.email_confirmed_at is not null)
      and exists(select 1 from public.league_members m where m.user_id=j.user_id and m.league_id=l.id)
      and not exists(select 1 from beta_private.service_email_preferences p where p.user_id=j.user_id and(not p.draft_updates or p.suppressed))
      and n.data->>'obsolete'is distinct from'true'
      and(n.kind not in('draft_schedule_changed','draft_reminder')or not(n.data?'schedule_version')or n.data->>'schedule_version'=l.draft_schedule_version::text)
      and(n.kind<>'draft_reminder'or(l.status='setup'and l.draft_scheduled_for>clock_timestamp()))
    ))));
end;$$;
create function public.service_email_sendable(p_job_id uuid,p_lease_token uuid)returns boolean language sql stable security invoker set search_path=''as $$select beta_private.service_email_sendable(p_job_id,p_lease_token);$$;
create function beta_private.contact_status_checked(p_request_id uuid)returns jsonb language sql stable security definer set search_path=''as $$
select jsonb_build_object('status',coalesce((select status from beta_private.service_email_jobs where dedupe_key='contact:'||p_request_id),'unknown'));
$$;
revoke all on function beta_private.contact_status_checked(uuid)from public,anon,authenticated,service_role;
create function beta_private.contact_message_status(p_request_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$begin
  perform beta_private.require_worker();return beta_private.contact_status_checked(p_request_id);
end;$$;
create function public.contact_message_status(p_request_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$select beta_private.contact_message_status(p_request_id);$$;
create function registration_private.contact_message_status(p_request_id uuid)returns jsonb language sql stable security definer set search_path=''as $$select beta_private.contact_status_checked(p_request_id);$$;
revoke all on function registration_private.contact_message_status(uuid)from public,anon,authenticated,service_role;
do $$begin if exists(select 1 from pg_roles where rolname='prelaunch_api')then grant execute on function registration_private.contact_message_status(uuid)to prelaunch_api;end if;end$$;

create function public.claim_service_email_jobs(p_limit integer default 20,p_job_id uuid default null)returns jsonb language sql security invoker set search_path='' as $$select beta_private.claim_service_email_jobs(p_limit,p_job_id);$$;
create function public.finish_service_email_job(p_job_id uuid,p_lease_token uuid,p_status text,p_provider_id text default null,p_failure_code text default null)returns boolean language sql security invoker set search_path='' as $$select beta_private.finish_service_email_job(p_job_id,p_lease_token,p_status,p_provider_id,p_failure_code);$$;
create function public.record_service_email_event(p_provider_id text,p_event text)returns boolean language sql security invoker set search_path='' as $$select beta_private.record_service_email_event(p_provider_id,p_event);$$;
create function public.suppress_draft_email(p_user_id uuid)returns void language sql security invoker set search_path='' as $$select beta_private.suppress_draft_email(p_user_id);$$;

do $grants$
declare p record;
begin
  for p in select oid::regprocedure signature from pg_proc where pronamespace in('public'::regnamespace,'beta_private'::regnamespace)
  and proname in('queue_contact_message','claim_service_email_jobs','finish_service_email_job','record_service_email_event','suppress_draft_email','service_email_sendable','contact_message_status')loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
    execute format('grant execute on function %s to service_role',p.signature);
  end loop;
end;
$grants$;
notify pgrst,'reload schema';
