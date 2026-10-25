set local lock_timeout='2s';
set local statement_timeout='30s';

-- - Record actual finalization rather than inventing dates for historical seasons
alter table public.fantasy_seasons add column finalized_at timestamptz;
create index fantasy_seasons_retention on public.fantasy_seasons(finalized_at,id)where finalized_at is not null;
create function beta_private.record_season_finalization()returns trigger language plpgsql set search_path=''as $$begin
  if new.status='complete'and old.status<>'complete'then new.finalized_at:=clock_timestamp();end if;
  if old.finalized_at is not null then new.finalized_at:=old.finalized_at;end if;
  return new;
end;$$;
create trigger season_finalization before update on public.fantasy_seasons for each row execute function beta_private.record_season_finalization();

create table beta_private.retention_cases(
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in('privacy','breach','support','moderation')),
  payload jsonb not null default '{}',
  verification_evidence jsonb,
  verified_at timestamptz,
  determined_at timestamptz,
  closed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check(kind<>'breach'or determined_at is not null)
);
create index retention_case_expiry on beta_private.retention_cases(expires_at,id)where expires_at is not null;
create index retention_evidence_expiry on beta_private.retention_cases(verified_at,id)where verification_evidence is not null;
create function beta_private.case_expiry()returns trigger language plpgsql set search_path=''as $$begin
  new.expires_at:=case when new.kind='breach'and new.closed_at is not null then greatest(new.determined_at+interval '24 months',new.closed_at)
    when new.closed_at is not null then new.closed_at+case when new.kind='support'then interval '12 months'else interval '24 months'end end;
  return new;
end;$$;
create trigger case_expiry before insert or update on beta_private.retention_cases for each row execute function beta_private.case_expiry();

create table beta_private.erasure_ledger(
  entity_kind text not null check(entity_kind in('account','league','source_import','season')),
  entity_id uuid not null,
  erased_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '90 days',
  primary key(entity_kind,entity_id)
);
create index erasure_ledger_expiry on beta_private.erasure_ledger(expires_at);
create table beta_private.retention_runs(
  id bigint generated always as identity primary key,
  started_at timestamptz not null default clock_timestamp(),
  removed integer not null default 0,
  status text not null check(status in('complete','budget_exhausted'))
);
create index retention_runs_expiry on beta_private.retention_runs(started_at);
create table beta_private.inactive_account_notices(
  user_id uuid primary key references auth.users(id)on delete cascade,
  activity_at timestamptz not null,
  notification_id uuid not null references public.notifications(id)on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create index inactive_notice_notification on beta_private.inactive_account_notices(notification_id);

-- - Shared source assets require a reviewed end date before removal
create table beta_private.source_asset_expiry(
  kind text not null check(kind in('competition','athlete')),
  entity_id uuid not null,
  covered_until timestamptz not null,
  expires_at timestamptz not null,
  review_reason text not null check(length(btrim(review_reason))between 8 and 500),
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key(kind,entity_id),
  check(expires_at<=covered_until+interval '5 years')
);
create index source_asset_expiry_due on beta_private.source_asset_expiry(expires_at,kind,entity_id);
do $$declare t text;begin
  foreach t in array array['retention_cases','erasure_ledger','retention_runs','inactive_account_notices','source_asset_expiry']loop
    execute format('alter table beta_private.%I enable row level security',t);
    execute format('revoke all on beta_private.%I from public,anon,authenticated,service_role',t);
  end loop;
end;$$;

create function beta_private.is_held(p_category text,p_key text)returns boolean language sql stable security definer set search_path=''as $$
  select exists(select 1 from beta_private.retention_holds where expires_at>clock_timestamp()
    and category in(p_category,'*')and record_key in(p_key,'*'));
$$;
create function beta_private.record_erasure()returns trigger language plpgsql security definer set search_path=''as $$begin
  insert into beta_private.erasure_ledger(entity_kind,entity_id)values(tg_argv[0],old.id)
  on conflict(entity_kind,entity_id)do update set erased_at=clock_timestamp(),expires_at=clock_timestamp()+interval '90 days';
  return old;
end;$$;
create trigger account_erasure after delete on auth.users for each row execute function beta_private.record_erasure('account');
create trigger league_erasure after delete on public.leagues for each row execute function beta_private.record_erasure('league');
create trigger source_erasure after delete on public.source_imports for each row execute function beta_private.record_erasure('source_import');
create trigger season_erasure after delete on public.fantasy_seasons for each row execute function beta_private.record_erasure('season');

-- - Preserve invitation decisions while allowing the inviter's account reference to be removed
alter table beta_private.admin_invitations alter column invited_by drop not null;
do $$declare constraint_name text;begin
  select c.conname into constraint_name from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
    where c.conrelid='beta_private.admin_invitations'::regclass and c.contype='f'and a.attname='invited_by';
  execute format('alter table beta_private.admin_invitations drop constraint %I',constraint_name);
end;$$;
alter table beta_private.admin_invitations add constraint admin_invitations_inviter_fk foreign key(invited_by)references public.profiles(id)on delete set null;

create function beta_private.erase_account(p_user_id uuid)returns boolean language plpgsql security definer set search_path=''as $$begin
  perform beta_private.require_worker();
  if p_user_id is null then raise exception 'Account required'using errcode='22023';end if;
  if beta_private.is_held('account',p_user_id::text)then raise exception 'Contact Ty to review the active privacy or dispute hold before deleting this account'using errcode='PT409';end if;
  -- - Keep source records and earned competition results while removing restrictive account references
  delete from public.trade_votes where user_id=p_user_id;
  update public.player_pools set rankings_approved_by=null where rankings_approved_by=p_user_id;
  update public.source_imports set imported_by=null where imported_by=p_user_id;
  delete from auth.users where id=p_user_id;
  return true;
end;$$;
create function public.erase_account(p_user_id uuid)returns boolean language sql security invoker set search_path=''as $$select beta_private.erase_account(p_user_id);$$;
revoke all on function beta_private.erase_account(uuid),public.erase_account(uuid)from public,anon,authenticated,service_role;
grant execute on function beta_private.erase_account(uuid),public.erase_account(uuid)to service_role;

-- - Walk incoming foreign keys only and cap total deleted rows across the whole tree
-- - Preserve held rows and stop before deleting a parent with remaining dependants
create function beta_private.expire_tree(p_table regclass,p_filter text,p_budget integer,p_started timestamptz,p_depth integer default 0)returns integer
language plpgsql security definer set search_path=''as $$
declare ids tid[];fk record;join_clause text;child_filter text;used integer:=0;n integer;remaining boolean;category text;key_expression text;
begin
  if p_budget<=0 or p_depth>24 or clock_timestamp()-p_started>interval '5 seconds'then return 0;end if;
  if p_table::oid not in(select c.oid from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname in('auth','public','beta_private','registration_private')and c.relkind='r')then raise exception 'Invalid retention relation: %',p_table;end if;
  category:=case p_table when 'auth.users'::regclass then 'account'when 'public.leagues'::regclass then 'league'
    when 'public.source_imports'::regclass then 'source_import'when 'public.fantasy_seasons'::regclass then 'season'else p_table::text end;
  key_expression:=case p_table when 'beta_private.draft_preference_snapshots'::regclass then 't.draft_id::text||'':''||t.fantasy_team_id::text'
    when 'beta_private.draft_preferences'::regclass then 't.fantasy_team_id::text'
    when 'public.idempotency_keys'::regclass then 't.user_id::text||'':''||t.command||'':''||t.idempotency_key'
    else 'coalesce(to_jsonb(t)->>''id'',to_jsonb(t)::text)'end;
  execute format('select array_agg(ctid)from(select t.ctid from %s t where (%s)and not beta_private.is_held(%L,%s) limit %s for update skip locked)q',p_table,p_filter,category,key_expression,p_budget)into ids;
  if ids is null then return 0;end if;
  if p_depth=0 and category in('account','league','source_import','season')then
    execute format('insert into beta_private.erasure_ledger(entity_kind,entity_id)select %L,id from %s where ctid=any(%L::tid[])on conflict do nothing',category,p_table,ids::text);
  end if;
  for fk in select c.oid,c.conrelid::regclass child,c.conkey,c.confkey from pg_constraint c
    where c.contype='f'and c.confrelid=p_table and c.confdeltype not in('n','d')order by c.oid
  loop
    select string_agg(format('t.%I=p.%I',ca.attname,pa.attname),' and 'order by k.n)into join_clause
    from unnest(fk.conkey,fk.confkey)with ordinality k(child_key,parent_key,n)
      join pg_attribute ca on ca.attrelid=fk.child and ca.attnum=k.child_key
      join pg_attribute pa on pa.attrelid=p_table and pa.attnum=k.parent_key;
    child_filter:=format('exists(select 1 from %s p where p.ctid=any(%L::tid[])and %s)',p_table,ids::text,join_clause);
    used:=used+beta_private.expire_tree(fk.child,child_filter,p_budget-used,p_started,p_depth+1);
    execute format('select exists(select 1 from %s t where %s)',fk.child,child_filter)into remaining;
    if remaining then return used;end if;
  end loop;
  if used>=p_budget or clock_timestamp()-p_started>interval '5 seconds'then return used;end if;
  execute format('delete from %s where ctid in(select unnest(%L::tid[])limit %s)',p_table,ids::text,p_budget-used);
  get diagnostics n=row_count;
  return used+n;
end;$$;

create index notifications_retention on public.notifications(created_at,id);
create index push_deliveries_retention on public.push_deliveries(created_at,id);
create index push_tokens_retention on public.push_tokens(updated_at,id)where not enabled;
create index chat_messages_retention on public.chat_messages(created_at,id);
create index audit_log_retention on public.audit_log(created_at,id);
create index command_receipt_retention on public.idempotency_keys(created_at);
create index source_import_retention on public.source_imports(created_at,id)where status in('preview','rejected');
create index rate_limit_retention on beta_private.rate_limits(window_start);
-- - Keep provider-owned Auth tables on their managed indexes

alter table beta_private.release_controls add column fresh_command_keys_required boolean not null default false;
create or replace function beta_private.begin_command(command text,request_key text)returns jsonb language plpgsql security definer set search_path=''as $$
declare u uuid:=beta_private.require_user();result jsonb;issued numeric;
begin
  if request_key is null or char_length(request_key)not between 8 and 200 then raise exception 'Invalid idempotency key'using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||':'||command||':'||request_key,0));
  select response into result from public.idempotency_keys where user_id=u and idempotency_keys.command=begin_command.command and idempotency_key=request_key;
  if result is not null then return result;end if;
  if(select fresh_command_keys_required from beta_private.release_controls)then
    if request_key!~'^bf2:[0-9]{13}:[0-9a-f-]{36}$'then raise exception 'Reload the application before submitting this action'using errcode='PT409';end if;
    issued:=split_part(request_key,':',2)::numeric;
    if issued<extract(epoch from clock_timestamp()-interval '24 hours')*1000 or issued>extract(epoch from clock_timestamp()+interval '5 minutes')*1000 then
      raise exception 'This action expired; review the current state before trying again'using errcode='PT409';
    end if;
  end if;
  return null;
end;$$;

create function beta_private.process_retention(p_limit integer default 100)returns jsonb language plpgsql security definer set search_path=''as $$
declare started timestamptz:=clock_timestamp();used integer:=0;target record;spec record;activity timestamptz;notice uuid;
begin
  perform beta_private.require_worker();
  if p_limit not between 1 and 500 then raise exception 'Invalid retention batch limit'using errcode='22023';end if;
  if not(select retention_enabled from beta_private.release_controls)then return '{"enabled":false}';end if;
  if not pg_try_advisory_xact_lock(hashtextextended('brock-retention',0))then return '{"busy":true}';end if;
  for spec in select * from(values
    ('beta_private.draft_preference_snapshots','t.expires_at<=clock_timestamp()'),
    ('beta_private.draft_preferences','t.expires_at<=clock_timestamp()'),
    ('public.push_deliveries','t.created_at<clock_timestamp()-interval ''90 days'''),
    ('beta_private.service_email_events','t.created_at<clock_timestamp()-interval ''90 days'''),
    ('public.push_tokens','not t.enabled and t.updated_at<clock_timestamp()-interval ''30 days'''),
    ('beta_private.service_email_jobs','t.kind in(''draft'',''account'')and t.created_at<clock_timestamp()-interval ''90 days''or t.kind=''contact''and t.status not in(''queued'',''leased'')and t.updated_at<clock_timestamp()-interval ''12 months'''),
    ('public.notifications','t.created_at<clock_timestamp()-interval ''90 days''and not exists(select 1 from beta_private.inactive_account_notices i where i.notification_id=t.id)'),
    ('public.chat_messages','t.created_at<clock_timestamp()-interval ''12 months''and not exists(select 1 from public.chat_reports r where r.message_id=t.id and(r.resolved_at is null or r.resolved_at>clock_timestamp()-interval ''24 months''))'),
    ('public.chat_reports','t.resolved_at<clock_timestamp()-interval ''24 months'''),
    ('public.audit_log','t.created_at<clock_timestamp()-interval ''24 months'''),
    ('beta_private.rate_limits','t.window_start<clock_timestamp()-interval ''90 days'''),
    ('beta_private.retention_cases','t.expires_at<clock_timestamp()'),
    ('beta_private.retention_runs','t.started_at<clock_timestamp()-interval ''90 days'''),
    ('beta_private.erasure_ledger','t.expires_at<clock_timestamp()'),
    ('public.source_imports','t.status in(''preview'',''rejected'')and t.created_at<clock_timestamp()-interval ''90 days'''),
    ('public.leagues','exists(select 1 from public.player_pools p join public.fantasy_seasons s on s.id=p.season_id where p.id=t.pool_id and s.status=''complete''and s.finalized_at<clock_timestamp()-interval ''24 months'')'),
    ('public.fantasy_seasons','t.status=''complete''and t.finalized_at is not null and exists(select 1 from public.fantasy_periods p where p.season_id=t.id)and not exists(select 1 from public.fantasy_periods p where p.season_id=t.id and p.ends_at>clock_timestamp()-interval ''5 years'')')
  )v(relation,condition)loop
    exit when used>=p_limit or clock_timestamp()-started>interval '5 seconds';
    used:=used+beta_private.expire_tree(spec.relation::regclass,spec.condition,p_limit-used,started);
  end loop;
  if used<p_limit and(select fresh_command_keys_required from beta_private.release_controls)then
    used:=used+beta_private.expire_tree('public.idempotency_keys','t.created_at<clock_timestamp()-interval ''90 days''and not exists(select 1 from public.league_members m join public.leagues l on l.id=m.league_id where m.user_id=t.user_id and l.status in(''setup'',''drafting'',''active''))',p_limit-used,started);
  end if;
  update beta_private.retention_cases set verification_evidence=null where id in(select id from beta_private.retention_cases where verification_evidence is not null and verified_at<clock_timestamp()-interval '30 days'and not beta_private.is_held('beta_private.retention_cases',id::text)limit p_limit);
  -- - Expired unverified accounts have no confirmed access and are removed one at a time
  for target in select id from auth.users u where email_confirmed_at is null and created_at<clock_timestamp()-interval '30 days'and not beta_private.is_held('account',id::text)limit 5 loop
    exit when used>=p_limit or clock_timestamp()-started>interval '5 seconds';
    used:=used+beta_private.expire_tree('auth.users',format('t.id=%L::uuid',target.id),p_limit-used,started);
  end loop;
  -- - Count refresh activity so continuously signed-in users are never classified as inactive
  for target in select * from(select u.id,u.created_at,greatest(u.created_at,u.last_sign_in_at,coalesce((select max(greatest(s.updated_at,s.refreshed_at at time zone 'UTC',s.created_at))from auth.sessions s where s.user_id=u.id),u.created_at))last_activity
    from auth.users u where email_confirmed_at is not null and u.created_at<clock_timestamp()-interval '24 months'
      and not beta_private.is_held('account',u.id::text)and not exists(select 1 from public.user_roles r where r.user_id=u.id and r.role='admin')
      and not exists(select 1 from public.league_members m join public.leagues l on l.id=m.league_id where m.user_id=u.id and l.status in('setup','drafting','active'))
    )candidates where last_activity<clock_timestamp()-interval '24 months'order by created_at,id limit 5
  loop
    exit when used>=p_limit or clock_timestamp()-started>interval '5 seconds';
    if target.last_activity>clock_timestamp()-interval '24 months'then delete from beta_private.inactive_account_notices where user_id=target.id;continue;end if;
    select j.updated_at into activity from beta_private.inactive_account_notices i join beta_private.service_email_jobs j on j.notification_id=i.notification_id
      where i.user_id=target.id and i.activity_at=target.last_activity and j.status in('accepted','delivered');
    if activity<clock_timestamp()-interval '30 days'then
      used:=used+beta_private.expire_tree('auth.users',format('t.id=%L::uuid',target.id),p_limit-used,started);
    elsif not exists(select 1 from beta_private.inactive_account_notices where user_id=target.id and activity_at=target.last_activity)then
      insert into public.notifications(user_id,kind,title,body,dedupe_key)values(target.id,'account_inactivity','Account inactivity review','Your account has had no sign-in or session activity for two years. Sign in within 30 days to keep it, or contact Ty for help.','inactive:'||target.id||':'||target.last_activity)returning id into notice;
      insert into beta_private.inactive_account_notices(user_id,activity_at,notification_id)values(target.id,target.last_activity,notice)on conflict(user_id)do update set activity_at=excluded.activity_at,notification_id=excluded.notification_id,created_at=clock_timestamp();
    end if;
  end loop;
  for target in select * from beta_private.source_asset_expiry where expires_at<clock_timestamp()order by expires_at limit 5 loop
    exit when used>=p_limit or clock_timestamp()-started>interval '5 seconds';
    if target.kind='athlete'and not exists(select 1 from public.athlete_seasons where athlete_id=target.entity_id)then
      used:=used+beta_private.expire_tree('public.athletes',format('t.id=%L::uuid',target.entity_id),p_limit-used,started);
      if not exists(select 1 from public.athletes where id=target.entity_id)then delete from beta_private.source_asset_expiry where kind=target.kind and entity_id=target.entity_id;end if;
    elsif target.kind='competition'and not exists(select 1 from public.pool_competitions where competition_id=target.entity_id)
      and not exists(select 1 from public.leagues where competition_id=target.entity_id)
      and not exists(select 1 from public.athlete_seasons s join public.athletes a on a.id=s.athlete_id where s.competition_id=target.entity_id or a.competition_id=target.entity_id)then
      used:=used+beta_private.expire_tree('public.competitions',format('t.id=%L::uuid',target.entity_id),p_limit-used,started);
      if not exists(select 1 from public.competitions where id=target.entity_id)then delete from beta_private.source_asset_expiry where kind=target.kind and entity_id=target.entity_id;end if;
    end if;
  end loop;
  insert into beta_private.retention_runs(removed,status)values(used,case when used>=p_limit or clock_timestamp()-started>=interval '5 seconds'then'budget_exhausted'else'complete'end);
  return jsonb_build_object('removed',used,'budget',p_limit,'freshCommandKeysRequired',(select fresh_command_keys_required from beta_private.release_controls));
end;$$;

create function beta_private.export_erasure_ledger()returns jsonb language plpgsql stable security definer set search_path=''as $$begin
  perform beta_private.require_worker();
  return jsonb_build_object('capturedAt',clock_timestamp(),'entries',coalesce((select jsonb_agg(jsonb_build_object('kind',entity_kind,'id',entity_id))from beta_private.erasure_ledger where expires_at>clock_timestamp()),'[]'));
end;$$;
create function public.export_erasure_ledger()returns jsonb language sql stable security invoker set search_path=''as $$select beta_private.export_erasure_ledger();$$;
revoke all on function public.export_erasure_ledger()from public,anon,authenticated;
grant execute on function public.export_erasure_ledger()to service_role;

-- - Correct existing reminder wording without changing deduplication or cadence
do $reminders$declare definition text;anchor text;begin
  definition:=pg_get_functiondef('rpc_private.process_in_app_reminders()'::regprocedure);
  anchor:='''Your league draft is scheduled soon. The commissioner starts it manually.''';
  if position(anchor in definition)=0 then raise exception 'Expected draft reminder wording';end if;
  execute replace(definition,anchor,'case when l.draft_mode=''scheduled_auto''then''Your automatic draft is scheduled soon. Save your private rankings before the cutoff; you do not need to be online.''else''Your live draft is scheduled soon. Your commissioner starts it at the agreed time.''end');
end;$reminders$;

create function beta_private.dispatch_service_email_tick()returns boolean language plpgsql security definer set search_path=''as $$
declare worker_url text;worker_secret text;request_id bigint;
begin
  perform beta_private.require_worker();
  if not(select service_email_enabled from beta_private.release_controls)then return false;end if;
  if to_regclass('vault.decrypted_secrets')is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)')is null then raise exception 'Private email dispatcher is not configured'using errcode='55000';end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'into worker_url using 'brock_service_email_worker_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name=$1'into worker_secret using 'brock_service_email_worker_secret';
  if worker_url is distinct from 'https://play.brockfantasy.ca/api/service-email/worker'or length(coalesce(worker_secret,''))<32 then raise exception 'Private email dispatcher is not configured'using errcode='55000';end if;
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=90000)'into request_id
    using worker_url,'{}'::jsonb,jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret);
  return request_id is not null;
end;$$;

do $grants$declare p record;begin
  for p in select oid::regprocedure signature from pg_proc where pronamespace='beta_private'::regnamespace and proname in(
    'record_season_finalization','case_expiry','is_held','record_erasure','expire_tree','process_retention','export_erasure_ledger','dispatch_service_email_tick')loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
  end loop;
end;$grants$;
grant execute on function beta_private.export_erasure_ledger()to service_role;
select cron.schedule('brock-retention','17 * * * *','select beta_private.process_retention(100);');
select cron.schedule('brock-service-email','* * * * *','select beta_private.dispatch_service_email_tick();');
notify pgrst,'reload schema';
