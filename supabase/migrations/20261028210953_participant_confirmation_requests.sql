set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table beta_private.release_controls add column participant_confirmation_enabled boolean not null default false;
create table beta_private.participant_confirmation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null,
  reference_id uuid not null,
  account_hash text not null,
  reference_hash text not null,
  participation_revision bigint not null,
  expected_review_id uuid,
  suggested_role text not null,
  suggested_programs text[] not null,
  status text not null default 'pending' check(status in('pending','responded','approved','rejected','superseded','obsolete')),
  response_role text,
  response_programs text[],
  explanation text check(length(explanation)<=1000),
  requested_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_reason text check(length(btrim(review_reason)) between 8 and 500),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '7 days',
  responded_at timestamptz,
  reviewed_at timestamptz
);
alter table beta_private.participant_confirmation_requests enable row level security;
revoke all on beta_private.participant_confirmation_requests from public,anon,authenticated,service_role;
create index participant_request_recent on beta_private.participant_confirmation_requests(created_at desc,id desc);
create index participant_request_account on beta_private.participant_confirmation_requests(user_id,created_at desc,id desc);
create index participant_request_expiry on beta_private.participant_confirmation_requests(updated_at,id);
create index participant_request_actor on beta_private.participant_confirmation_requests(requested_by);
create index participant_request_reviewer on beta_private.participant_confirmation_requests(reviewed_by);
create unique index participant_request_active on beta_private.participant_confirmation_requests(user_id) where status in('pending','responded');

alter table beta_private.service_email_jobs drop constraint service_email_jobs_kind_check;
alter table beta_private.service_email_jobs drop constraint service_email_jobs_check;
alter table beta_private.service_email_jobs add column participation_request_id uuid references beta_private.participant_confirmation_requests(id) on delete cascade;
alter table beta_private.service_email_jobs add constraint service_email_jobs_kind_check check(kind in('contact','draft','account','participation'));
alter table beta_private.service_email_jobs add constraint service_email_jobs_check check(
  (kind in('draft','account') and user_id is not null and notification_id is not null and participation_request_id is null)
  or(kind='contact' and participation_request_id is null)
  or(kind='participation' and user_id is not null and participation_request_id is not null and notification_id is null));
create unique index service_email_participant_request on beta_private.service_email_jobs(participation_request_id) where participation_request_id is not null;

create function beta_private.participant_response_valid(p_role text,p_programs text[]) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_role in('none','athlete','coach','athlete_coach') and p_programs is not null
    and array_position(p_programs,null) is null and cardinality(p_programs)=(select count(distinct p) from unnest(p_programs)p)
    and p_programs <@ array['mens_hockey','womens_hockey','mens_basketball','womens_basketball','mens_volleyball','womens_volleyball']
    and ((p_role='none' and cardinality(p_programs)=0) or(p_role<>'none' and cardinality(p_programs) between 1 and 6)),false);
$$;
alter table beta_private.participant_confirmation_requests add constraint participant_request_suggestion_valid
  check(beta_private.participant_response_valid(suggested_role,suggested_programs));
alter table beta_private.participant_confirmation_requests add constraint participant_request_response_valid
  check((response_role is null and response_programs is null) or beta_private.participant_response_valid(response_role,response_programs));

create function beta_private.participant_request_current(r beta_private.participant_confirmation_requests) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    join beta_private.account_participation a on a.user_id=p.id
    where p.id=r.user_id and p.deleted_at is null and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and beta_private.participant_account_hash(p.display_name,u.email)=r.account_hash and a.revision=r.participation_revision)
    and exists(select 1 from beta_private.participant_references ref join beta_private.participant_reference_versions v on v.id=ref.version_id and v.active
      where ref.id=r.reference_id and ref.evidence_hash=r.reference_hash)
    and (select id from beta_private.participant_scan_reviews review where review.user_id=r.user_id and review.reference_id=r.reference_id
      and review.account_hash=r.account_hash and review.reference_hash=r.reference_hash order by reviewed_at desc,id desc limit 1) is not distinct from r.expected_review_id;
$$;
create function beta_private.participant_request_status(r beta_private.participant_confirmation_requests) returns text
language sql stable security definer set search_path='' as $$
  select case when r.status in('pending','responded') and not beta_private.participant_request_current(r) then 'obsolete'
    when r.status='pending' and r.expires_at<=statement_timestamp() then 'expired' else r.status end;
$$;
create function beta_private.participant_request_json(r beta_private.participant_confirmation_requests,p_admin boolean) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'user_id',r.user_id,'match_id',r.match_id,
    'display_name',p.display_name,'email',case when p_admin then u.email end,
    'suggested_role',r.suggested_role,'suggested_programs',r.suggested_programs,
    'status',beta_private.participant_request_status(r),'created_at',r.created_at,'updated_at',r.updated_at,
    'expires_at',r.expires_at,'responded_at',r.responded_at,'reviewed_at',r.reviewed_at,
    'response_role',r.response_role,'response_programs',r.response_programs,'explanation',r.explanation,
    'review_reason',case when p_admin then r.review_reason end,
    'requested_by',case when p_admin then coalesce(requester.display_name,'Deleted administrator') end,
    'reviewed_by',case when p_admin and r.reviewed_at is not null then coalesce(reviewer.display_name,'Deleted administrator') end,
    'delivery_status',j.status,'delivery_failure',j.failure_code)
  from public.profiles p join auth.users u on u.id=p.id
  left join public.profiles requester on requester.id=r.requested_by and requester.deleted_at is null
  left join public.profiles reviewer on reviewer.id=r.reviewed_by and reviewer.deleted_at is null
  left join beta_private.service_email_jobs j on j.participation_request_id=r.id
  where p.id=r.user_id and p.deleted_at is null;
$$;

create function rpc_private.admin_list_participant_requests(p_status text default '',p_query text default '',
  p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform beta_private.require_participant_admin();
  if p_status is null or p_status not in('','pending','responded','approved','rejected','expired','obsolete','superseded')
    or p_query is null or length(p_query)>320 or (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid request filters' using errcode='22023';end if;
  with page as materialized (
    select r.* from beta_private.participant_confirmation_requests r join public.profiles p on p.id=r.user_id and p.deleted_at is null
    join auth.users u on u.id=p.id
    where (p_status='' or beta_private.participant_request_status(r)=p_status)
      and (p_query='' or strpos(lower(p.display_name||' '||u.email),lower(btrim(p_query)))>0)
      and (p_before_at is null or(r.created_at,r.id)<(p_before_at,p_before_id)) order by r.created_at desc,r.id desc limit 51
  ), visible as(select * from page order by created_at desc,id desc limit 50)
  select jsonb_build_object('enabled',(select participant_confirmation_enabled and service_email_enabled from beta_private.release_controls),
    'items',coalesce((select jsonb_agg(beta_private.participant_request_json(v::beta_private.participant_confirmation_requests,true) order by created_at desc,id desc)
      from visible v),'[]'),'hasMore',(select count(*)>50 from page),
    'nextCursor',(select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1)) into result;
  return result;
end;$$;

create function rpc_private.admin_request_participant_confirmation(p_match_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=beta_private.require_participant_admin(); m beta_private.participant_scan_matches%rowtype;
  r beta_private.participant_confirmation_requests%rowtype; result jsonb; review beta_private.participant_scan_reviews%rowtype;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('participant-scan-publication',0));
  result:=beta_private.begin_command('admin_request_participant_confirmation',p_idempotency_key); if result is not null then return result;end if;
  if not(select participant_confirmation_enabled and service_email_enabled from beta_private.release_controls) then
    raise exception 'Confirmation email is awaiting release checks' using errcode='PT409';end if;
  select * into m from beta_private.participant_scan_matches where id=p_match_id;
  if m.id is null then raise exception 'Match unavailable; refresh the scan' using errcode='PT409';end if;
  perform pg_advisory_xact_lock(hashtextextended('participant-request:'||m.user_id::text,0));
  if exists(select 1 from beta_private.participant_confirmation_requests where user_id=m.user_id and created_at>clock_timestamp()-interval '24 hours') then
    raise exception 'A confirmation email was already requested for this account in the last 24 hours' using errcode='PT429';end if;
  perform 1 from public.profiles p join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id where p.id=m.user_id for update of p,u,a;
  perform pg_advisory_xact_lock(hashtextextended('participant-review:'||m.user_id::text||':'||m.reference_id::text,0));
  select * into review from beta_private.participant_scan_reviews where user_id=m.user_id and reference_id=m.reference_id
    and account_hash=m.account_hash and reference_hash=m.reference_hash order by reviewed_at desc,id desc limit 1;
  r.user_id:=m.user_id;r.match_id:=m.id;r.reference_id:=m.reference_id;r.account_hash:=m.account_hash;r.reference_hash:=m.reference_hash;r.expected_review_id:=review.id;
  select revision into r.participation_revision from beta_private.account_participation where user_id=m.user_id;
  if not beta_private.participant_request_current(r) or coalesce(review.dismissed,false)
    or exists(select 1 from beta_private.account_participation where user_id=m.user_id and role<>'none') then
    raise exception 'Matching evidence or participation changed; refresh and run a new scan' using errcode='PT409';end if;
  if exists(select 1 from beta_private.participant_confirmation_requests where user_id=m.user_id and status='responded'
    and beta_private.participant_request_current(participant_confirmation_requests)) then
    raise exception 'Review this account response before requesting another confirmation' using errcode='PT409';end if;
  update beta_private.participant_confirmation_requests set status='superseded',updated_at=clock_timestamp()
    where user_id=m.user_id and status in('pending','responded');
  insert into beta_private.participant_confirmation_requests(user_id,match_id,reference_id,account_hash,reference_hash,participation_revision,
    expected_review_id,suggested_role,suggested_programs,requested_by)
  values(m.user_id,m.id,m.reference_id,m.account_hash,m.reference_hash,r.participation_revision,review.id,m.evidence->'reference'->>'role',
    array(select jsonb_array_elements_text(m.evidence->'reference'->'programs')),actor) returning * into r;
  insert into beta_private.service_email_jobs(dedupe_key,kind,user_id,participation_request_id,payload)
    values('participant-confirmation:'||r.id,'participation',r.user_id,r.id,jsonb_build_object('requestId',r.id,'expiresAt',r.expires_at));
  perform beta_private.audit('participant.confirmation_requested','participant_request',r.id::text,null,jsonb_build_object('status','pending'),p_idempotency_key);
  return beta_private.finish_command('admin_request_participant_confirmation',p_idempotency_key,jsonb_build_object('requestId',r.id));
end;$$;

create function rpc_private.get_my_participant_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r beta_private.participant_confirmation_requests%rowtype;
begin
  perform rpc_private.require_app_access();
  select * into r from beta_private.participant_confirmation_requests where id=p_request_id and user_id=auth.uid();
  if r.id is null then raise exception 'Confirmation request unavailable for this account' using errcode='P0002';end if;
  return beta_private.participant_request_json(r,false);
end;$$;
create function rpc_private.submit_participant_confirmation(p_request_id uuid,p_role text,p_programs text[],p_explanation text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r beta_private.participant_confirmation_requests%rowtype; result jsonb;
begin
  perform rpc_private.require_app_access();
  perform pg_advisory_xact_lock_shared(hashtextextended('participant-scan-publication',0));
  result:=beta_private.begin_command('submit_participant_confirmation',p_idempotency_key);if result is not null then return result;end if;
  select * into r from beta_private.participant_confirmation_requests where id=p_request_id and user_id=auth.uid() for update;
  if r.id is null then raise exception 'Confirmation request unavailable for this account' using errcode='P0002';end if;
  perform 1 from public.profiles p join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id where p.id=r.user_id for update of p,u,a;
  if beta_private.participant_request_status(r)<>'pending' then raise exception 'This request is no longer accepting responses' using errcode='PT409';end if;
  if not beta_private.participant_response_valid(p_role,p_programs) or p_explanation is null or length(p_explanation)>1000 then
    raise exception 'Select a valid role and its programs' using errcode='22023';end if;
  update beta_private.participant_confirmation_requests set status='responded',response_role=p_role,response_programs=p_programs,
    explanation=nullif(btrim(p_explanation),''),responded_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  perform beta_private.audit('participant.confirmation_submitted','participant_request',r.id::text,null,jsonb_build_object('status','responded'),p_idempotency_key);
  return beta_private.finish_command('submit_participant_confirmation',p_idempotency_key,jsonb_build_object('status','responded'));
end;$$;
create function rpc_private.admin_review_participant_confirmation(p_request_id uuid,p_approve boolean,p_reason text,
  p_expected_updated_at timestamptz,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=beta_private.require_participant_admin(); r beta_private.participant_confirmation_requests%rowtype; result jsonb;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('participant-scan-publication',0));
  result:=beta_private.begin_command('admin_review_participant_confirmation',p_idempotency_key);if result is not null then return result;end if;
  select * into r from beta_private.participant_confirmation_requests where id=p_request_id for update;
  perform 1 from public.profiles p join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id where p.id=r.user_id for update of p,u,a;
  perform pg_advisory_xact_lock(hashtextextended('participant-review:'||r.user_id::text||':'||r.reference_id::text,0));
  if r.id is null or beta_private.participant_request_status(r)<>'responded' or r.updated_at is distinct from p_expected_updated_at then
    raise exception 'Response or participation changed; reload and review again' using errcode='PT409';end if;
  if p_approve is null or p_reason is null or length(btrim(p_reason)) not between 8 and 500 then raise exception 'Enter a review reason of 8 to 500 characters' using errcode='22023';end if;
  if p_approve then
    perform rpc_private.admin_set_participation(r.user_id,r.response_role,r.response_programs,r.participation_revision,btrim(p_reason),'confirmation:'||r.id);
    if r.response_role='none' then
      perform pg_advisory_xact_lock(hashtextextended('participant-review:'||r.user_id::text||':'||r.reference_id::text,0));
      if (select id from beta_private.participant_scan_reviews where user_id=r.user_id and reference_id=r.reference_id
        and account_hash=r.account_hash and reference_hash=r.reference_hash order by reviewed_at desc,id desc limit 1) is distinct from r.expected_review_id then
        raise exception 'Match review changed; reload and review again' using errcode='PT409';end if;
      insert into beta_private.participant_scan_reviews(user_id,reference_id,account_hash,reference_hash,dismissed,reason,reviewed_by)
        values(r.user_id,r.reference_id,r.account_hash,r.reference_hash,true,btrim(p_reason),actor);
    end if;
  end if;
  update beta_private.participant_confirmation_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=actor,review_reason=btrim(p_reason),reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
  perform beta_private.audit('participant.confirmation_reviewed','participant_request',r.id::text,null,
    jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end),p_idempotency_key);
  return beta_private.finish_command('admin_review_participant_confirmation',p_idempotency_key,jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end));
end;$$;

-- - Invalidate outstanding requests immediately when account identity or participation changes
create function beta_private.invalidate_participant_requests() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if tg_table_name='account_participation' then target:=new.user_id;else target:=new.id;end if;
  if tg_table_name='profiles' and to_jsonb(new)->>'deleted_at' is not null then
    delete from beta_private.participant_confirmation_requests where user_id=target;
  else
    update beta_private.participant_confirmation_requests r set status='obsolete',updated_at=clock_timestamp()
      where r.user_id=target and r.status in('pending','responded') and not beta_private.participant_request_current(r);
  end if;
  return new;
end;$$;
create trigger participant_requests_profile after update of display_name,deleted_at on public.profiles for each row execute function beta_private.invalidate_participant_requests();
create trigger participant_requests_email after update of email,email_confirmed_at,banned_until on auth.users for each row execute function beta_private.invalidate_participant_requests();
create trigger participant_requests_participation after update of revision on beta_private.account_participation for each row execute function beta_private.invalidate_participant_requests();

create or replace function beta_private.claim_service_email_jobs(p_limit integer default 20,p_job_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;batch uuid:=gen_random_uuid();
begin
  perform beta_private.require_worker();
  if p_limit is null or p_limit not between 1 and 25 then raise exception 'Invalid batch limit' using errcode='22023';end if;
  if not(select service_email_enabled from beta_private.release_controls)then return '[]';end if;
  update beta_private.service_email_jobs set status='failed',failure_code='delivery_window_expired',lease_token=null,lease_until=null
    where status in('queued','leased') and created_at<clock_timestamp()-interval '23 hours' and(lease_until is null or lease_until<=clock_timestamp());
  update beta_private.service_email_jobs set status='failed',lease_token=null,lease_until=null,failure_code='lease_attempts_exhausted'
    where status='leased' and lease_until<=clock_timestamp() and attempts>=5;
  with due as(select j.id from beta_private.service_email_jobs j where(p_job_id is null or j.id=p_job_id) and j.status in('queued','leased') and j.attempts<5
    and j.created_at>=clock_timestamp()-interval '23 hours' and j.next_attempt_at<=clock_timestamp() and(j.lease_until is null or j.lease_until<=clock_timestamp())
    order by j.next_attempt_at,j.id limit p_limit for update skip locked)
  update beta_private.service_email_jobs j set status='leased',lease_token=batch,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1,updated_at=clock_timestamp()
    from due where j.id=due.id;
  update beta_private.service_email_jobs j set status='suppressed',lease_until=null,lease_token=null
    where j.status='leased' and j.lease_token=batch and j.kind in('draft','account','participation') and(
      not exists(select 1 from auth.users u where u.id=j.user_id and u.email_confirmed_at is not null)
      or exists(select 1 from beta_private.service_email_preferences p where p.user_id=j.user_id and((j.kind='draft' and not p.draft_updates)or p.suppressed))
      or exists(select 1 from public.notifications n where n.id=j.notification_id and n.data->>'obsolete'='true'));
  update beta_private.service_email_jobs j set status='obsolete',lease_until=null,lease_token=null
    where j.status='leased' and j.lease_token=batch and j.kind='participation' and(not(select participant_confirmation_enabled from beta_private.release_controls)or not exists(
      select 1 from beta_private.participant_confirmation_requests r where r.id=j.participation_request_id and r.user_id=j.user_id and beta_private.participant_request_status(r)='pending'));
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'kind',j.kind,'leaseToken',j.lease_token,'attempts',j.attempts,'userId',j.user_id,'email',u.email,
    'payload',case when j.kind in('contact','participation')then j.payload else jsonb_build_object('kind',n.kind,'title',n.title,'body',n.body,'data',n.data)end)),'[]') into result
    from beta_private.service_email_jobs j left join auth.users u on u.id=j.user_id left join public.notifications n on n.id=j.notification_id
    where j.status='leased' and j.lease_until>clock_timestamp() and j.lease_token=batch;
  return result;
end;$$;

-- - Preserve existing account and draft delivery rules and add recipient-bound confirmation checks
alter function beta_private.service_email_sendable(uuid,uuid) rename to service_email_sendable_existing;
create function beta_private.service_email_sendable(p_job_id uuid,p_lease_token uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  perform beta_private.require_worker();
  if exists(select 1 from beta_private.service_email_jobs where id=p_job_id and kind='participation') then
    return exists(select 1 from beta_private.service_email_jobs j join beta_private.participant_confirmation_requests r on r.id=j.participation_request_id and r.user_id=j.user_id
      where j.id=p_job_id and j.status='leased' and j.lease_token=p_lease_token and j.lease_until>clock_timestamp()
      and beta_private.participant_request_status(r)='pending' and(select participant_confirmation_enabled from beta_private.release_controls)
      and not exists(select 1 from beta_private.service_email_preferences p where p.user_id=j.user_id and p.suppressed));
  end if;
  return beta_private.service_email_sendable_existing(p_job_id,p_lease_token);
end;$$;
create or replace function public.service_email_sendable(p_job_id uuid,p_lease_token uuid) returns boolean language sql stable security invoker set search_path='' as $$select beta_private.service_email_sendable(p_job_id,p_lease_token);$$;

create function beta_private.expire_participant_requests(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid cleanup budget';end if;
  return beta_private.expire_tree('beta_private.participant_confirmation_requests','t.updated_at<clock_timestamp()-interval ''90 days''',p_limit,clock_timestamp());
end;$$;
select cron.schedule('brock-participant-request-retention','41 * * * *','select beta_private.expire_participant_requests(100);');

create function public.admin_list_participant_requests(p_status text default '',p_query text default '',p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_list_participant_requests(p_status,p_query,p_before_at,p_before_id);$$;
create function public.admin_request_participant_confirmation(p_match_id uuid,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.admin_request_participant_confirmation(p_match_id,p_idempotency_key);$$;
create function public.get_my_participant_request(p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.get_my_participant_request(p_request_id);$$;
create function public.submit_participant_confirmation(p_request_id uuid,p_role text,p_programs text[],p_explanation text,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.submit_participant_confirmation(p_request_id,p_role,p_programs,p_explanation,p_idempotency_key);$$;
create function public.admin_review_participant_confirmation(p_request_id uuid,p_approve boolean,p_reason text,p_expected_updated_at timestamptz,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.admin_review_participant_confirmation(p_request_id,p_approve,p_reason,p_expected_updated_at,p_idempotency_key);$$;

do $$declare r record;begin
  for r in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where(n.nspname='beta_private' and p.proname in('participant_response_valid','participant_request_current','participant_request_status','participant_request_json','invalidate_participant_requests','expire_participant_requests','service_email_sendable','service_email_sendable_existing'))
    or(n.nspname in('public','rpc_private') and p.proname in('admin_list_participant_requests','admin_request_participant_confirmation','get_my_participant_request','submit_participant_confirmation','admin_review_participant_confirmation')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    if r.nspname in('public','rpc_private') then execute format('grant execute on function %s to authenticated',r.signature);
    elsif r.signature::text like '%service_email_sendable(%' then execute format('grant execute on function %s to service_role',r.signature);end if;
  end loop;
end;$$;
notify pgrst,'reload schema';

create or replace function rpc_private.admin_get_participant_scan(p_scan_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare run beta_private.participant_scan_runs%rowtype; v uuid; latest uuid; result jsonb;
begin
  perform beta_private.require_participant_admin();
  select id into v from beta_private.participant_reference_versions where active;
  select id into latest from beta_private.participant_scan_runs where completed_at is not null order by completed_at desc,id desc limit 1;
  select * into run from beta_private.participant_scan_runs where completed_at is not null and (p_scan_id is null or id=p_scan_id)
    and (id=latest or completed_at>=statement_timestamp()-interval '90 days') order by completed_at desc,id desc limit 1;
  select jsonb_build_object('confirmationEnabled',(select participant_confirmation_enabled and service_email_enabled from beta_private.release_controls),'enabled',(select enabled from beta_private.participant_scan_settings),'activeReferenceVersionId',v,
    'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.completed_at desc,h.id desc),'[]') from (
      select s.*,coalesce(p.display_name,'Deleted administrator') runner_name from beta_private.participant_scan_runs s left join public.profiles p on p.id=s.ran_by and p.deleted_at is null
      where s.completed_at is not null and (s.id=latest or s.completed_at>=statement_timestamp()-interval '90 days') order by s.completed_at desc,s.id desc)h),
    'run',case when run.id is not null then to_jsonb(run)||jsonb_build_object('runner_name',coalesce((select display_name from public.profiles where id=run.ran_by and deleted_at is null),'Deleted administrator')) end,
    'newRegistrations',case when run.id is null then 0 else (select count(*) from public.profiles where deleted_at is null and created_at>run.started_at) end,
    'matches',(select coalesce(jsonb_agg(to_jsonb(q) order by q.score desc,lower(q.display_name),q.user_id,q.reference_id),'[]') from (
      select m.*,p.display_name,u.email,a.role,a.programs,a.revision,
        (a.role<>'none') resolved,
        (m.account_hash<>beta_private.participant_account_hash(p.display_name,u.email)) evidence_changed,
        coalesce(review.dismissed,false) and m.account_hash=beta_private.participant_account_hash(p.display_name,u.email) dismissed,
        review.id review_id,review.reason review_reason,review.reviewed_at,review.reviewed_by,
        reviewer.display_name reviewer_name,confirmation.confirmation_request
      from beta_private.participant_scan_matches m join public.profiles p on p.id=m.user_id and p.deleted_at is null
      join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id
      left join lateral(select * from beta_private.participant_scan_reviews r where r.user_id=m.user_id and r.reference_id=m.reference_id
        and r.account_hash=m.account_hash and r.reference_hash=m.reference_hash order by r.reviewed_at desc,r.id desc limit 1)review on true
      left join public.profiles reviewer on reviewer.id=review.reviewed_by and reviewer.deleted_at is null
      left join lateral(select jsonb_build_object('id',request.id,'status',beta_private.participant_request_status(request),
        'created_at',request.created_at,'delivery_status',(select status from beta_private.service_email_jobs where participation_request_id=request.id)) confirmation_request
        from beta_private.participant_confirmation_requests request where request.user_id=m.user_id order by request.created_at desc,request.id desc limit 1)confirmation on true
      where m.scan_id=run.id
    )q)) into result;
  return result;
end;$$;

create or replace function beta_private.operations_audit_rows() returns table(
  id bigint,created_at timestamptz,action text,category text,actor_id uuid,actor text,
  entity_type text,entity_id text,entity_name text,summary text,before_state jsonb,after_state jsonb)
language sql stable security invoker as $$
  select e.id,e.created_at,e.action,split_part(e.action,'.',1),e.actor_id,
    case when e.actor_id is null then 'System or deleted account'
      when p.deleted_at is not null then 'Deleted administrator' else coalesce(p.display_name,'Deleted administrator') end,
    e.entity_type,e.entity_id,coalesce(l.name,t.name,case when target.deleted_at is null then target.display_name end,a.display_name,case when recipient.deleted_at is null then recipient.display_name end,replace(source.program,'_',' '),case when game.id is not null then home.name||' vs '||away.name end),
    initcap(replace(replace(e.action,'.',' '),'_',' ')),
    beta_private.operations_fields(e.before_state),beta_private.operations_fields(e.after_state)
  from public.audit_log e left join public.profiles p on p.id=e.actor_id
  left join public.leagues l on e.entity_type='league' and l.id=beta_private.operations_uuid(e.entity_id)
  left join public.fantasy_teams t on e.entity_type in('fantasy_team','team') and t.id=beta_private.operations_uuid(e.entity_id)
  left join public.profiles target on e.entity_type in('profile','account') and target.id=beta_private.operations_uuid(e.entity_id)
  left join public.athletes a on e.entity_type='athlete' and a.id=beta_private.operations_uuid(e.entity_id)
    and a.fantasy_withdrawn_at is null
  left join beta_private.participant_confirmation_requests request on e.entity_type='participant_request' and request.id=beta_private.operations_uuid(e.entity_id)
  left join public.profiles recipient on recipient.id=request.user_id
  left join public.official_schedule_sources source on e.entity_type='schedule_source' and source.id=beta_private.operations_uuid(e.entity_id)
  left join public.games game on e.entity_type='game' and game.id=beta_private.operations_uuid(e.entity_id)
  left join public.teams home on home.id=game.home_team_id left join public.teams away on away.id=game.away_team_id;
$$;
