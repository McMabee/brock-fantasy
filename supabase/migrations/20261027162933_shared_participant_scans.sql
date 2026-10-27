set local lock_timeout = '2s';
set local statement_timeout = '30s';

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create table beta_private.participant_scan_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  scoring_version text not null default 'participant-match-v1',
  weights jsonb not null default '{"email":100,"name":90,"email_username":80,"inferred_username":60,"minimum":35}',
  check(jsonb_typeof(weights)='object'),
  check(weights ?& array['email','name','email_username','inferred_username','minimum']),
  check((weights->>'minimum')::int between 1 and 100),
  check((weights->>'email')::int between 1 and 100 and (weights->>'name')::int between 1 and 100
    and (weights->>'email_username')::int between 1 and 100 and (weights->>'inferred_username')::int between 1 and 100)
);
insert into beta_private.participant_scan_settings(singleton) values(true);

create table beta_private.participant_reference_versions (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique,
  season_id uuid not null references public.fantasy_seasons(id) on delete cascade,
  sources jsonb not null,
  imported_by uuid references public.profiles(id) on delete set null,
  imported_at timestamptz not null default clock_timestamp(),
  active boolean not null default false
);
create unique index participant_reference_active on beta_private.participant_reference_versions((true)) where active;
create index participant_reference_season on beta_private.participant_reference_versions(season_id);
create index participant_reference_importer on beta_private.participant_reference_versions(imported_by);

create function beta_private.participant_name(p_value text) returns text
language sql stable set search_path='' as $$
  select btrim(regexp_replace(translate(lower(extensions.unaccent(coalesce(p_value,''))),'''’',''), '[^[:alnum:]]+', ' ', 'g'));
$$;
create function beta_private.participant_tokens(p_value text) returns text
language sql stable set search_path='' as $$
  select coalesce(string_agg(token,' ' order by token),'')
  from regexp_split_to_table(beta_private.participant_name(p_value),' +') token where token<>'';
$$;
create function beta_private.participant_username(p_value text) returns text
language sql immutable set search_path='' as $$
  select regexp_replace(regexp_replace(lower(split_part(coalesce(p_value,''),'@',1)),'[^[:alnum:]]','','g'),'[0-9]+$','');
$$;
create function beta_private.participant_account_hash(p_name text,p_email text) returns text
language sql immutable set search_path='' as $$
  select encode(extensions.digest(jsonb_build_array(p_name,lower(btrim(p_email)))::text,'sha256'),'hex');
$$;

create table beta_private.participant_references (
  version_id uuid not null references beta_private.participant_reference_versions(id) on delete cascade,
  id uuid not null,
  name text not null check(char_length(name) between 1 and 120),
  emails text[] not null default '{}',
  role text not null check(role in('athlete','coach','athlete_coach')),
  programs text[] not null check(cardinality(programs) between 1 and 6 and programs <@ array['mens_hockey','womens_hockey','mens_basketball','womens_basketball','mens_volleyball','womens_volleyball']),
  sources jsonb not null,
  evidence_hash text not null,
  normalized_name text not null,
  sorted_name text not null,
  usernames text[] not null,
  inferred_usernames text[] not null,
  primary key(version_id,id)
);
-- - Reference imports are infrequent batches and searches must not scan a fresh GIN pending list
create index participant_reference_names on beta_private.participant_references using gin(normalized_name extensions.gin_trgm_ops) with(fastupdate=off);
create index participant_reference_tokens on beta_private.participant_references using gin(sorted_name extensions.gin_trgm_ops) with(fastupdate=off);
create index participant_reference_emails on beta_private.participant_references using gin(emails) with(fastupdate=off);
create index participant_reference_inferred on beta_private.participant_references using gin(inferred_usernames) with(fastupdate=off);

-- - Index supplied usernames separately to keep fuzzy email comparisons independent of domains
create table beta_private.participant_reference_usernames (
  version_id uuid not null,
  reference_id uuid not null,
  username text not null,
  primary key(version_id,reference_id,username),
  foreign key(version_id,reference_id) references beta_private.participant_references(version_id,id) on delete cascade
);
create index participant_reference_username_match on beta_private.participant_reference_usernames using gin(username extensions.gin_trgm_ops) with(fastupdate=off);

create table beta_private.participant_scan_runs (
  id uuid primary key default gen_random_uuid(),
  reference_version_id uuid not null references beta_private.participant_reference_versions(id) on delete cascade,
  scoring_version text not null,
  weights jsonb not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  ran_by uuid references public.profiles(id) on delete set null,
  account_count integer not null default 0,
  result_count integer not null default 0
);
create index participant_scan_recent on beta_private.participant_scan_runs(completed_at desc,id) where completed_at is not null;
create index participant_scan_reference on beta_private.participant_scan_runs(reference_version_id);
create index participant_scan_runner on beta_private.participant_scan_runs(ran_by);

create table beta_private.participant_scan_matches (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references beta_private.participant_scan_runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reference_id uuid not null,
  account_hash text not null,
  reference_hash text not null,
  score integer not null check(score between 1 and 100),
  evidence jsonb not null,
  unique(scan_id,user_id,reference_id)
);
create index participant_match_account on beta_private.participant_scan_matches(user_id);
create index participant_match_ranking on beta_private.participant_scan_matches(scan_id,score desc,user_id);

-- - Append review events so undo preserves the previous administrator's decision
create table beta_private.participant_scan_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reference_id uuid not null,
  account_hash text not null,
  reference_hash text not null,
  dismissed boolean not null,
  reason text not null check(char_length(btrim(reason)) between 8 and 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz not null default clock_timestamp()
);
create index participant_review_latest on beta_private.participant_scan_reviews(user_id,reference_id,account_hash,reference_hash,reviewed_at desc,id desc);
create index participant_review_actor on beta_private.participant_scan_reviews(reviewed_by);
create index participant_review_expiry on beta_private.participant_scan_reviews(reviewed_at,id);

create function beta_private.require_participant_admin() returns uuid language plpgsql stable security definer set search_path='' as $$
declare u uuid:=beta_private.require_user(); begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Administrator MFA required' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=u and deleted_at is null) then raise exception 'Account unavailable' using errcode='42501'; end if;
  return u;
end;$$;

-- - Publication is operator CLI only and never granted to client roles
create function beta_private.publish_participant_references(p_document text,p_operator uuid,p_expected_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p_payload jsonb:=p_document::jsonb; v uuid; entry jsonb; ref uuid; emails text[]; programs text[]; n text; tokens text[]; inferred text[]; h text;
begin
  if not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id
    where r.user_id=p_operator and r.role='admin' and p.deleted_at is null) then raise exception 'An active administrator importer is required'; end if;
  if p_expected_hash is distinct from encode(extensions.digest(p_document,'sha256'),'hex') then
    raise exception 'Reference preview hash changed' using errcode='PT409';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('participant-scan-publication',0)) then raise exception 'A scan or reference import is already running' using errcode='PT409'; end if;
  select id into v from beta_private.participant_reference_versions where content_hash=p_expected_hash;
  if v is not null then return jsonb_build_object('versionId',v,'unchanged',true); end if;
  if jsonb_array_length(p_payload->'sources')<>12 or jsonb_array_length(p_payload->'references')=0 then raise exception 'All twelve sources and at least one reference are required'; end if;
  insert into beta_private.participant_reference_versions(content_hash,season_id,sources,imported_by)
    values(p_expected_hash,(p_payload->>'seasonId')::uuid,p_payload->'sources',p_operator) returning id into v;
  for entry in select value from jsonb_array_elements(p_payload->'references') loop
    ref:=(entry->>'id')::uuid;
    select coalesce(array_agg(distinct lower(btrim(value)) order by lower(btrim(value))),'{}') into emails from jsonb_array_elements_text(entry->'emails');
    select array_agg(distinct value order by value) into programs from jsonb_array_elements_text(entry->'programs');
    n:=beta_private.participant_name(entry->>'name');
    if n='' or exists(select 1 from unnest(emails)e where e!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Invalid reference name or email'; end if;
    tokens:=regexp_split_to_array(n,' +');
    inferred:=case when cardinality(tokens)>1 then array[
      replace(n,' ',''),tokens[1]||tokens[cardinality(tokens)],tokens[cardinality(tokens)]||tokens[1],left(tokens[1],1)||tokens[cardinality(tokens)]
    ] else '{}'::text[] end;
    -- - File revisions and row moves do not invalidate an otherwise unchanged dismissal
    h:=encode(extensions.digest(jsonb_build_object('name',entry->>'name','emails',emails,'role',entry->>'role','programs',programs,
      'titles',(select jsonb_agg(jsonb_build_array(s->>'title',s->'supportingStaff') order by s->>'key') from jsonb_array_elements(entry->'sources')s))::text,'sha256'),'hex');
    insert into beta_private.participant_references(version_id,id,name,emails,role,programs,sources,evidence_hash,normalized_name,sorted_name,usernames,inferred_usernames)
      values(v,ref,entry->>'name',emails,entry->>'role',programs,entry->'sources',h,n,beta_private.participant_tokens(n),
        array(select distinct beta_private.participant_username(e) from unnest(emails)e),inferred);
    insert into beta_private.participant_reference_usernames select v,ref,username from
      (select distinct beta_private.participant_username(e) username from unnest(emails)e)q where username<>'';
  end loop;
  analyze beta_private.participant_references;
  analyze beta_private.participant_reference_usernames;
  update beta_private.participant_reference_versions set active=false where active;
  update beta_private.participant_reference_versions set active=true where id=v;
  insert into public.audit_log(actor_id,action,entity_type,entity_id,after_state)
    values(p_operator,'participant.references_imported','participant_reference_version',v::text,jsonb_build_object('count',jsonb_array_length(p_payload->'references'),'hash',p_expected_hash));
  return jsonb_build_object('versionId',v,'references',jsonb_array_length(p_payload->'references'));
end;$$;

create function rpc_private.admin_list_varsity_participants() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform beta_private.require_participant_admin();
  return (select coalesce(jsonb_agg(to_jsonb(q) order by lower(q.display_name),q.id),'[]') from
    (select p.id,p.display_name,u.email,a.role,a.programs,a.revision from public.profiles p join auth.users u on u.id=p.id
      join beta_private.account_participation a on a.user_id=p.id where p.deleted_at is null and a.role<>'none')q);
end;$$;
create function rpc_private.admin_get_participant(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform beta_private.require_participant_admin();
  return (select jsonb_build_object('id',p.id,'display_name',p.display_name,'email',u.email,'role',a.role,'programs',a.programs,'revision',a.revision)
    from public.profiles p join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id where p.id=p_user_id and p.deleted_at is null);
end;$$;

create function rpc_private.admin_run_participant_scan(p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=beta_private.require_participant_admin(); result jsonb; settings beta_private.participant_scan_settings%rowtype; v uuid; run uuid; n integer; total integer;
begin
  result:=beta_private.begin_command('admin_run_participant_scan',p_idempotency_key); if result is not null then return result; end if;
  select * into settings from beta_private.participant_scan_settings;
  if not settings.enabled then raise exception 'Participant scans are awaiting hosted acceptance' using errcode='PT409'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('participant-scan-publication',0)) then raise exception 'A scan or reference import is already running' using errcode='PT409'; end if;
  select id into v from beta_private.participant_reference_versions where active;
  if v is null then raise exception 'Import participant references before running a scan' using errcode='PT409'; end if;
  -- - Use a conservative index threshold so integer rounding cannot omit a stored match
  perform set_config('pg_trgm.similarity_threshold',greatest(0.01,((settings.weights->>'minimum')::numeric-0.5)/greatest((settings.weights->>'name')::int,(settings.weights->>'email_username')::int))::text,true);
  insert into beta_private.participant_scan_runs(reference_version_id,scoring_version,weights,ran_by)
    values(v,settings.scoring_version,settings.weights,actor) returning id into run;
  with accounts as materialized (
    select p.id,p.display_name,u.email,beta_private.participant_name(p.display_name) name,beta_private.participant_tokens(p.display_name) tokens,
      beta_private.participant_username(u.email) username,beta_private.participant_account_hash(p.display_name,u.email) fingerprint
    from public.profiles p join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id
    where p.deleted_at is null and a.role='none'
  ), pairs as materialized (
    select a.*,r.* from accounts a cross join lateral (
      select x.id reference_id from beta_private.participant_references x where x.version_id=v and x.normalized_name operator(extensions.%) a.name
      union select x.id from beta_private.participant_references x where x.version_id=v and x.sorted_name operator(extensions.%) a.tokens
      union select x.id from beta_private.participant_references x where x.version_id=v and x.emails @> array[lower(btrim(a.email))]
      union select x.reference_id from beta_private.participant_reference_usernames x where x.version_id=v and a.username<>'' and x.username operator(extensions.%) a.username
      union select x.id from beta_private.participant_references x where x.version_id=v and a.username<>'' and x.inferred_usernames @> array[a.username]
    )candidate join lateral (
      select x.id ref_id,x.evidence_hash,
        jsonb_build_object('name',x.name,'emails',x.emails,'role',x.role,'programs',x.programs,'sources',x.sources) reference,
        case when lower(btrim(a.email))=any(x.emails) then (settings.weights->>'email')::int else 0 end email_score,
        round((settings.weights->>'name')::numeric*greatest(extensions.similarity(a.name,x.normalized_name),extensions.similarity(a.tokens,x.sorted_name)))::int name_score,
        coalesce((select round((settings.weights->>'email_username')::numeric*max(extensions.similarity(a.username,t)))::int from unnest(x.usernames)t where a.username<>''),0) username_score,
        case when a.username<>'' and a.username=any(x.inferred_usernames) then (settings.weights->>'inferred_username')::int else 0 end inferred_score
      from beta_private.participant_references x where x.version_id=v and x.id=candidate.reference_id offset 0
    )r on true
  ), scored as (
    select *,greatest(email_score,name_score,username_score,inferred_score) score from pairs
  ), inserted as (
    insert into beta_private.participant_scan_matches(scan_id,user_id,reference_id,account_hash,reference_hash,score,evidence)
    select run,id,ref_id,fingerprint,evidence_hash,score,jsonb_build_object('reference',reference,'accountName',display_name,'accountEmail',email,
      'reasons',to_jsonb(array_remove(array[
        case when email_score>0 then 'Exact supplied email' end,
        case when name_score= (settings.weights->>'name')::int then 'Exact normalized full name' when name_score>=(settings.weights->>'minimum')::int then 'Similar full name' end,
        case when username_score>=(settings.weights->>'minimum')::int then 'Similar supplied email username' end,
        case when inferred_score>0 then 'Inferred email username' end
      ],null)), 'scores',jsonb_build_object('email',email_score,'name',name_score,'emailUsername',username_score,'inferredUsername',inferred_score))
    from scored where score >= (settings.weights->>'minimum')::int returning user_id
  ) select count(distinct user_id),(select count(*) from accounts) into n,total from inserted;
  update beta_private.participant_scan_runs set completed_at=clock_timestamp(),result_count=n,
    account_count=total where id=run;
  perform beta_private.audit('participant.scan_completed','participant_scan',run::text,null,jsonb_build_object('results',n,'referenceVersionId',v),p_idempotency_key);
  return beta_private.finish_command('admin_run_participant_scan',p_idempotency_key,jsonb_build_object('scanId',run));
end;$$;

create function rpc_private.admin_get_participant_scan(p_scan_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare run beta_private.participant_scan_runs%rowtype; v uuid; latest uuid; result jsonb;
begin
  perform beta_private.require_participant_admin();
  select id into v from beta_private.participant_reference_versions where active;
  select id into latest from beta_private.participant_scan_runs where completed_at is not null order by completed_at desc,id desc limit 1;
  select * into run from beta_private.participant_scan_runs where completed_at is not null and (p_scan_id is null or id=p_scan_id)
    and (id=latest or completed_at>=statement_timestamp()-interval '90 days') order by completed_at desc,id desc limit 1;
  select jsonb_build_object('enabled',(select enabled from beta_private.participant_scan_settings),'activeReferenceVersionId',v,
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
        reviewer.display_name reviewer_name
      from beta_private.participant_scan_matches m join public.profiles p on p.id=m.user_id and p.deleted_at is null
      join auth.users u on u.id=p.id join beta_private.account_participation a on a.user_id=p.id
      left join lateral(select * from beta_private.participant_scan_reviews r where r.user_id=m.user_id and r.reference_id=m.reference_id
        and r.account_hash=m.account_hash and r.reference_hash=m.reference_hash order by r.reviewed_at desc,r.id desc limit 1)review on true
      left join public.profiles reviewer on reviewer.id=review.reviewed_by and reviewer.deleted_at is null
      where m.scan_id=run.id
    )q)) into result;
  return result;
end;$$;

create function rpc_private.admin_review_participant_match(p_match_id uuid,p_dismissed boolean,p_reason text,p_expected_review_id uuid,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=beta_private.require_participant_admin(); m beta_private.participant_scan_matches%rowtype; latest uuid; result jsonb; event uuid;
begin
  result:=beta_private.begin_command('admin_review_participant_match',p_idempotency_key); if result is not null then return result; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 or p_dismissed is null then raise exception 'Enter a review reason of 8 to 500 characters' using errcode='22023'; end if;
  select * into m from beta_private.participant_scan_matches where id=p_match_id;
  if m.id is null then raise exception 'Match unavailable; refresh the scan' using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('participant-review:'||m.user_id::text||':'||m.reference_id::text,0));
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=m.user_id and p.deleted_at is null
    and m.account_hash=beta_private.participant_account_hash(p.display_name,u.email)) or not exists(
      select 1 from beta_private.participant_references r join beta_private.participant_reference_versions v on v.id=r.version_id and v.active
      where r.id=m.reference_id and r.evidence_hash=m.reference_hash
    ) then raise exception 'Matching evidence changed; run a new scan' using errcode='PT409'; end if;
  select id into latest from beta_private.participant_scan_reviews where user_id=m.user_id and reference_id=m.reference_id
    and account_hash=m.account_hash and reference_hash=m.reference_hash order by reviewed_at desc,id desc limit 1;
  if latest is distinct from p_expected_review_id then raise exception 'Review changed; refresh and retry' using errcode='PT409'; end if;
  insert into beta_private.participant_scan_reviews(user_id,reference_id,account_hash,reference_hash,dismissed,reason,reviewed_by)
    values(m.user_id,m.reference_id,m.account_hash,m.reference_hash,p_dismissed,btrim(p_reason),actor) returning id into event;
  perform beta_private.audit('participant.match_reviewed','participant_review',event::text,null,jsonb_build_object('dismissed',p_dismissed),p_idempotency_key);
  return beta_private.finish_command('admin_review_participant_match',p_idempotency_key,jsonb_build_object('reviewId',event));
end;$$;

-- - Soft deletion clears private account evidence as well as the hard-delete foreign keys
create function beta_private.clear_participant_scan_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from beta_private.participant_scan_matches where user_id=new.id;
    delete from beta_private.participant_scan_reviews where user_id=new.id;
  end if;
  return new;
end;$$;
create trigger clear_participant_scan_account after update of deleted_at on public.profiles for each row execute function beta_private.clear_participant_scan_account();

create function beta_private.expire_participant_scans(p_limit integer default 100) returns integer language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp(); used integer:=0; latest uuid;
begin
  if p_limit not between 1 and 1000 then raise exception 'Invalid cleanup budget'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('participant-scan-retention',0)) then return 0; end if;
  select id into latest from beta_private.participant_scan_runs where completed_at is not null order by completed_at desc,id desc limit 1;
  used:=beta_private.expire_tree('beta_private.participant_scan_runs',format('t.completed_at<clock_timestamp()-interval ''90 days'' and t.id<>%L::uuid',coalesce(latest,'00000000-0000-0000-0000-000000000000'::uuid)),p_limit,started);
  used:=used+beta_private.expire_tree('beta_private.participant_scan_reviews',
    't.reviewed_at<clock_timestamp()-interval ''90 days'' and not (t.dismissed and
      exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=t.user_id and p.deleted_at is null and t.account_hash=beta_private.participant_account_hash(p.display_name,u.email)) and
      exists(select 1 from beta_private.participant_references r join beta_private.participant_reference_versions v on v.id=r.version_id and v.active where r.id=t.reference_id and r.evidence_hash=t.reference_hash) and
      not exists(select 1 from beta_private.participant_scan_reviews newer where newer.user_id=t.user_id and newer.reference_id=t.reference_id and newer.account_hash=t.account_hash and newer.reference_hash=t.reference_hash and (newer.reviewed_at,newer.id)>(t.reviewed_at,t.id)))',
    p_limit-used,started);
  -- - Never traverse a reference version that still owns a retained scan
  used:=used+beta_private.expire_tree('beta_private.participant_reference_versions','not t.active and t.imported_at<clock_timestamp()-interval ''90 days'' and not exists(select 1 from beta_private.participant_scan_runs s where s.reference_version_id=t.id)',p_limit-used,started);
  return used;
end;$$;
select cron.schedule('brock-participant-scan-retention','37 * * * *','select beta_private.expire_participant_scans(100);');

-- - Public wrappers retain the existing invoker boundary and explicit authenticated grants
create function public.admin_list_varsity_participants() returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_list_varsity_participants();$$;
create function public.admin_get_participant(p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_participant(p_user_id);$$;
create function public.admin_get_participant_scan(p_scan_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_participant_scan(p_scan_id);$$;
create function public.admin_run_participant_scan(p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.admin_run_participant_scan(p_idempotency_key);$$;
create function public.admin_review_participant_match(p_match_id uuid,p_dismissed boolean,p_reason text,p_expected_review_id uuid,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.admin_review_participant_match(p_match_id,p_dismissed,p_reason,p_expected_review_id,p_idempotency_key);$$;

do $$declare r record;begin
  for r in select tablename from pg_tables where schemaname='beta_private' and tablename like 'participant_%' loop
    execute format('alter table beta_private.%I enable row level security',r.tablename);
    execute format('revoke all on beta_private.%I from public,anon,authenticated,service_role',r.tablename);
  end loop;
  for r in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='beta_private' and (p.proname like 'participant_%' or p.proname in('require_participant_admin','publish_participant_references','clear_participant_scan_account','expire_participant_scans')))
      or (n.nspname in('public','rpc_private') and p.proname in('admin_list_varsity_participants','admin_get_participant','admin_get_participant_scan','admin_run_participant_scan','admin_review_participant_match')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    if r.nspname in('public','rpc_private') then execute format('grant execute on function %s to authenticated',r.signature); end if;
  end loop;
end;$$;
notify pgrst,'reload schema';
