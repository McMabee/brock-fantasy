set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table public.sync_runs add column job_kind text not null default 'player'
  check(job_kind in('player','schedule'));
create index sync_runs_admin_cursor on public.sync_runs(started_at desc,id desc);
create index sync_runs_admin_kind on public.sync_runs(job_kind,status,started_at desc,id desc);
create index sync_runs_admin_finished on public.sync_runs(finished_at desc,id desc) where finished_at is not null;
create index sync_errors_admin_cursor on public.sync_errors(created_at desc,id desc);
create index sync_errors_admin_run on public.sync_errors(sync_run_id,created_at desc,id desc) where sync_run_id is not null;
create index audit_log_admin_cursor on public.audit_log(created_at desc,id desc);
create index audit_log_admin_actor on public.audit_log(actor_id,created_at desc,id desc);
create index audit_log_admin_category on public.audit_log((split_part(action,'.',1)),created_at desc,id desc);
create index audit_log_admin_entity on public.audit_log(entity_type,created_at desc,id desc);

create table beta_private.schedule_sync_alert_links (
  run_id uuid not null references public.sync_runs(id) on delete cascade,
  error_id uuid not null references public.sync_errors(id) on delete cascade,
  primary key(run_id,error_id)
);
create index schedule_sync_alert_error on beta_private.schedule_sync_alert_links(error_id);
alter table beta_private.schedule_sync_alert_links enable row level security;
revoke all on beta_private.schedule_sync_alert_links from public,anon,authenticated,service_role;

create function beta_private.operations_uuid(value text) returns uuid
language sql immutable set search_path='' as $$
  select case when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then value::uuid end;
$$;

-- - Return explicitly approved fields rather than arbitrary audit or provider payloads
create function beta_private.operations_fields(value jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(key,val),'{}') from jsonb_each(case when jsonb_typeof(value)='object' then value else '{}'::jsonb end) x(key,val)
  where (key in('status','role','programs','revision','version','changed','count','dismissed','enabled',
    'starts_at','ends_at','schedule_kind','schedule_confirmed','schedule_override','schedule_revision',
    'home_points','away_points','slot_code','roster_format','rank','period','stage','inserted_count',
    'updated_count','ignored_count','result_count','account_count') and jsonb_typeof(val) in('string','number','boolean','null'))
    or (key='programs' and jsonb_typeof(val)='array' and jsonb_array_length(case when jsonb_typeof(val)='array' then val else '[]' end)<=6
      and not exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(val)='array' then val else '[]' end)p where p not in('mens_hockey','womens_hockey','mens_basketball','womens_basketball','mens_volleyball','womens_volleyball')));
$$;

-- - Keep this private invoker helper inlineable so guarded callers can use the cursor index
-- - Qualify application objects and inherit the guarded caller's empty search path
create function beta_private.operations_audit_rows() returns table(
  id bigint,created_at timestamptz,action text,category text,actor_id uuid,actor text,
  entity_type text,entity_id text,entity_name text,summary text,before_state jsonb,after_state jsonb)
language sql stable security invoker as $$
  select e.id,e.created_at,e.action,split_part(e.action,'.',1),e.actor_id,
    case when e.actor_id is null then 'System or deleted account'
      when p.deleted_at is not null then 'Deleted administrator' else coalesce(p.display_name,'Deleted administrator') end,
    e.entity_type,e.entity_id,coalesce(l.name,t.name,case when target.deleted_at is null then target.display_name end,a.display_name),
    initcap(replace(replace(e.action,'.',' '),'_',' ')),
    beta_private.operations_fields(e.before_state),beta_private.operations_fields(e.after_state)
  from public.audit_log e left join public.profiles p on p.id=e.actor_id
  left join public.leagues l on e.entity_type='league' and l.id=beta_private.operations_uuid(e.entity_id)
  left join public.fantasy_teams t on e.entity_type in('fantasy_team','team') and t.id=beta_private.operations_uuid(e.entity_id)
  left join public.profiles target on e.entity_type in('profile','account') and target.id=beta_private.operations_uuid(e.entity_id)
  left join public.athletes a on e.entity_type='athlete' and a.id=beta_private.operations_uuid(e.entity_id)
    and a.fantasy_withdrawn_at is null;
$$;

create function rpc_private.admin_get_operations(p_section text default 'runs',p_kind text default 'all',
  p_status text default 'all',p_query text default '',p_category text default '',p_actor text default '',
  p_entity_type text default '',p_from date default null,p_to date default null,
  p_before_at timestamptz default null,p_before_id text default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; since_at timestamptz:=p_from::timestamp at time zone 'America/Toronto';
  until_at timestamptz:=(p_to+1)::timestamp at time zone 'America/Toronto';
begin
  perform beta_private.require_league_view_admin();
  if p_section is null or p_section not in('runs','alerts','audit') or p_kind is null or p_kind not in('all','player','schedule')
    or p_status is null or p_status not in('all','running','succeeded','failed','partial','unresolved','resolved')
    or p_query is null or length(p_query)>320 or length(coalesce(p_category,''))>100
    or length(coalesce(p_entity_type,''))>100 or length(coalesce(p_actor,''))>120
    or p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null)
    or (p_before_id is not null and length(p_before_id)>40) or p_from>p_to
 then
    raise exception 'Invalid operations filters' using errcode='22023';
  end if;
  if p_section='runs' then
    with page as materialized (
      select r.id::text,r.started_at created_at,r.started_at,r.finished_at,r.provider,r.job_kind,r.status,
        r.competition_id,c.name competition_name,c.season_label,
        r.inserted_count,r.updated_count,r.ignored_count,
        case when r.job_kind='schedule' then coalesce((select jsonb_agg(jsonb_build_object(
          'source_id',s.id,'program',s.program,'url',s.url,'status',x.value->>'status',
          'changed',x.value->'changed','started_at',x.value->'started_at','finished_at',x.value->'finished_at',
          'error_code',x.value->>'error_code') order by s.program)
          from jsonb_each(coalesce(r.metadata->'sources','{}'))x join public.official_schedule_sources s on s.id=beta_private.operations_uuid(x.key)),'[]') else '[]'::jsonb end sources,
        (select count(*) from(select e.id from public.sync_errors e where e.sync_run_id=r.id
          union select error_id from beta_private.schedule_sync_alert_links where run_id=r.id)linked_errors) alert_count
      from public.sync_runs r left join public.competitions c on c.id=r.competition_id
      where (p_kind='all' or r.job_kind=p_kind) and (p_status='all' or r.status::text=p_status)
        and (since_at is null or r.started_at>=since_at) and (until_at is null or r.started_at<until_at)
        and (p_before_at is null or (r.started_at,r.id)<(p_before_at,beta_private.operations_uuid(p_before_id)))
        and (p_query='' or strpos(lower(r.provider||' '||r.id::text),lower(btrim(p_query)))>0)
      order by r.started_at desc,r.id desc limit p_limit+1
    ), visible as(select * from page order by created_at desc,id desc limit p_limit)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id desc) from visible v),'[]'),
      'hasMore',(select count(*)>p_limit from page),'nextCursor',(select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1)) into result;
  elsif p_section='alerts' then
    with page as materialized (
      select e.id::text,e.created_at,e.error_code,coalesce(e.sync_run_id,(select link.run_id from beta_private.schedule_sync_alert_links link
        join public.sync_runs linked on linked.id=link.run_id where link.error_id=e.id order by linked.started_at desc,linked.id desc limit 1)) sync_run_id,e.resolved_at,
        case when e.resolved_at is null then 'unresolved' else 'resolved' end status,
        coalesce(p.display_name,case when e.resolved_by is not null then 'Deleted administrator' end) resolved_by,
        case when e.error_code='OFFICIAL_SCHEDULE_SYNC' then 'schedule' else 'player' end job_kind,
        case e.error_code when 'OFFICIAL_SCHEDULE_SYNC' then 'Official schedule synchronization needs review'
          when 'MISSING_PERIOD_PROJECTION' then 'An athlete projection is unavailable'
          else initcap(replace(e.error_code,'_',' ')) end summary,
        s.program,s.url source_url,r.provider,e.provider_snapshot_id,
        case when game.id is not null then home.name||' vs '||away.name end game_name,
        jsonb_strip_nulls(jsonb_build_object('source_id',s.id,'athlete_id',beta_private.operations_uuid(e.context->>'athlete_id'),
          'game_id',coalesce(snapshot.game_id,beta_private.operations_uuid(e.context->>'game_id')),
          'provider_athlete_id',case when e.context->>'providerAthleteId'~'^[A-Za-z0-9._:-]{1,120}$' then e.context->>'providerAthleteId' end,
          'missing_stats',case when jsonb_typeof(e.context->'missingStats')='array' then(select coalesce(jsonb_agg(value),'[]') from(
            select value from jsonb_array_elements_text(e.context->'missingStats') where value~'^[a-z][a-z0-9_]{0,40}$' limit 32)fields)end)) context
      from public.sync_errors e left join public.sync_runs r on r.id=e.sync_run_id
      left join public.provider_snapshots snapshot on snapshot.id=e.provider_snapshot_id
      left join public.games game on game.id=coalesce(snapshot.game_id,beta_private.operations_uuid(e.context->>'game_id'))
      left join public.teams home on home.id=game.home_team_id left join public.teams away on away.id=game.away_team_id
      left join public.profiles p on p.id=e.resolved_by and p.deleted_at is null
      left join public.official_schedule_sources s on s.id=beta_private.operations_uuid(e.context->>'source_id')
      where (p_kind='all' or (p_kind='schedule')=(e.error_code='OFFICIAL_SCHEDULE_SYNC'))
        and (p_status='all' or (p_status='unresolved' and e.resolved_at is null) or (p_status='resolved' and e.resolved_at is not null))
        and (since_at is null or e.created_at>=since_at) and (until_at is null or e.created_at<until_at)
        and (p_before_at is null or (e.created_at,e.id)<(p_before_at,beta_private.operations_uuid(p_before_id)))
        and (p_query='' or strpos(lower(e.error_code||' '||e.id::text||' '||coalesce(s.program,'')||' '||coalesce(r.provider,'')||' '||coalesce(e.sync_run_id::text,'')),lower(btrim(p_query)))>0
          or exists(select 1 from beta_private.schedule_sync_alert_links link where link.error_id=e.id and link.run_id=beta_private.operations_uuid(btrim(p_query))))
      order by e.created_at desc,e.id desc limit p_limit+1
    ), visible as(select * from page order by created_at desc,id desc limit p_limit)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id desc) from visible v),'[]'),
      'hasMore',(select count(*)>p_limit from page),'nextCursor',(select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1)) into result;
  else
    if p_before_id is not null and p_before_id !~ '^[0-9]{1,19}$' then raise exception 'Invalid audit cursor' using errcode='22023'; end if;
    with page as materialized (
      select * from beta_private.operations_audit_rows() e
      where (coalesce(p_category,'')='' or e.category=p_category) and (coalesce(p_entity_type,'')='' or e.entity_type=p_entity_type)
        and (coalesce(p_actor,'')='' or (p_actor='system' and e.actor_id is null) or e.actor_id=beta_private.operations_uuid(p_actor) or(p_actor<>'system' and strpos(lower(e.actor),lower(btrim(p_actor)))>0))
        and (since_at is null or e.created_at>=since_at) and (until_at is null or e.created_at<until_at)
        and (p_before_at is null or (e.created_at,e.id)<(p_before_at,p_before_id::bigint))
        and (p_query='' or strpos(lower(concat_ws(' ',e.summary,e.actor,e.entity_name,e.entity_id)),lower(btrim(p_query)))>0)
      order by e.created_at desc,e.id desc limit p_limit+1
    ), visible as(select * from page order by created_at desc,id desc limit p_limit)
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('id',id::text) order by created_at desc,id desc) from visible v),'[]'),
      'hasMore',(select count(*)>p_limit from page),'nextCursor',(select jsonb_build_object('at',created_at,'id',id::text) from visible order by created_at,id limit 1)) into result;
  end if;
  if p_section='runs' and p_kind='schedule' then
    result:=result||jsonb_build_object('legacySources',coalesce((select jsonb_agg(jsonb_build_object('id',id,'program',program,'url',url,
      'last_synced_at',last_synced_at,'needs_review',last_error is not null) order by program) from public.official_schedule_sources),'[]'));
  end if;
  if p_section='audit' then
    result:=result||jsonb_build_object('categories',coalesce((select jsonb_agg(category order by category) from(
      select distinct split_part(action,'.',1) category from public.audit_log order by category limit 200)catalog),'[]'),
      'entityTypes',coalesce((select jsonb_agg(entity_type order by entity_type) from(
        select distinct entity_type from public.audit_log order by entity_type limit 200)catalog),'[]'));
  end if;
  return result;
end;$$;

create function rpc_private.admin_get_operations_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform beta_private.require_league_view_admin();
  return jsonb_build_object('unresolvedErrors',(select count(*) from public.sync_errors where resolved_at is null),
    'latestSync',(select jsonb_build_object('provider',provider,'finished_at',finished_at,'job_kind',job_kind,'status',status) from(
      select provider,finished_at,job_kind,status::text,id from public.sync_runs where finished_at is not null
      union all select 'Brock '||replace(program,'_',' '),last_synced_at,'schedule','succeeded',id from public.official_schedule_sources where last_synced_at is not null
    )recent order by finished_at desc,id desc limit 1),
    'syncRows',rpc_private.admin_get_operations('runs',p_limit=>12)->'items',
    'auditEvents',rpc_private.admin_get_operations('audit',p_limit=>40)->'items');
end;$$;

-- - Record each worker invocation independently of fixture changes and source health
create function beta_private.begin_schedule_sync(p_run_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform beta_private.require_worker();
  update public.sync_runs set status='failed',finished_at=clock_timestamp()
    where job_kind='schedule' and status='running' and started_at<clock_timestamp()-interval '15 minutes';
  insert into public.sync_runs(id,provider,job_kind,metadata) values(p_run_id,'Brock schedules','schedule','{"sources":{}}') on conflict(id) do nothing;
  if not exists(select 1 from public.sync_runs where id=p_run_id and job_kind='schedule' and status='running') then
    raise exception 'Schedule run is unavailable' using errcode='22023';end if;
  return p_run_id;
end;$$;
create function beta_private.record_schedule_sync(p_run_id uuid,p_source_id uuid,p_status text,p_changed integer default 0,
  p_error_code text default null,p_started_at timestamptz default null) returns boolean language plpgsql security definer set search_path='' as $$
declare source public.official_schedule_sources%rowtype;
begin
  perform beta_private.require_worker();
  if p_status is null or p_status not in('succeeded','failed') or p_changed is null or p_changed not between 0 and 250
    or (p_error_code is not null and p_error_code not in('SOURCE_FETCH_FAILED','SOURCE_PARSE_FAILED','SOURCE_REVIEW_REQUIRED','DATABASE_APPLY_FAILED','SOURCE_SYNC_FAILED')) then
    raise exception 'Invalid schedule outcome' using errcode='22023';end if;
  select * into source from public.official_schedule_sources where id=p_source_id;
  if source.id is null then raise exception 'Approved source required' using errcode='22023'; end if;
  update public.sync_runs set metadata=jsonb_set(metadata,array['sources',p_source_id::text],jsonb_build_object(
    'status',p_status,'changed',p_changed,'error_code',p_error_code,'started_at',p_started_at,'finished_at',clock_timestamp()))
    where id=p_run_id and job_kind='schedule' and status='running';
  if found and p_status='failed' then
    insert into beta_private.schedule_sync_alert_links(run_id,error_id)
      select p_run_id,id from public.sync_errors where error_code='OFFICIAL_SCHEDULE_SYNC' and resolved_at is null and context->>'source_id'=p_source_id::text
      on conflict do nothing;
  end if;
  return exists(select 1 from public.sync_runs where id=p_run_id and job_kind='schedule' and status='running');
end;$$;
create function beta_private.finish_schedule_sync(p_run_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform beta_private.require_worker();
  update public.sync_runs r set status=case when (select count(*)=6 and bool_and(value->>'status'='succeeded') from jsonb_each(r.metadata->'sources')) then 'succeeded'::public.sync_status else 'failed'::public.sync_status end,
    finished_at=clock_timestamp(),updated_count=coalesce((select sum((value->>'changed')::int) from jsonb_each(r.metadata->'sources')),0)
  where r.id=p_run_id and r.job_kind='schedule' and r.status='running';
  return found;
end;$$;

create function public.admin_get_operations(p_section text default 'runs',p_kind text default 'all',p_status text default 'all',
  p_query text default '',p_category text default '',p_actor text default '',p_entity_type text default '',p_from date default null,
  p_to date default null,p_before_at timestamptz default null,p_before_id text default null,p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_operations(p_section,p_kind,p_status,p_query,p_category,p_actor,p_entity_type,p_from,p_to,p_before_at,p_before_id,p_limit);$$;
create function public.admin_get_operations_summary() returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_operations_summary();$$;
create function public.begin_schedule_sync(p_run_id uuid) returns uuid language sql security invoker set search_path='' as $$select beta_private.begin_schedule_sync(p_run_id);$$;
create function public.record_schedule_sync(p_run_id uuid,p_source_id uuid,p_status text,p_changed integer default 0,p_error_code text default null,p_started_at timestamptz default null)
returns boolean language sql security invoker set search_path='' as $$select beta_private.record_schedule_sync(p_run_id,p_source_id,p_status,p_changed,p_error_code,p_started_at);$$;
create function public.finish_schedule_sync(p_run_id uuid) returns boolean language sql security invoker set search_path='' as $$select beta_private.finish_schedule_sync(p_run_id);$$;

do $$declare r record;begin
  for r in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='beta_private' and p.proname in('operations_uuid','operations_fields','operations_audit_rows','begin_schedule_sync','record_schedule_sync','finish_schedule_sync'))
      or(n.nspname in('public','rpc_private') and p.proname in('admin_get_operations','admin_get_operations_summary','begin_schedule_sync','record_schedule_sync','finish_schedule_sync')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    if r.proname in('begin_schedule_sync','record_schedule_sync','finish_schedule_sync') then
      execute format('grant execute on function %s to service_role',r.signature);
    elsif r.nspname in('public','rpc_private') then execute format('grant execute on function %s to authenticated',r.signature);end if;
  end loop;
end;$$;
notify pgrst,'reload schema';
