set local lock_timeout = '2s';
set local statement_timeout = '30s';

create function rpc_private.admin_list_leagues_filtered(p_seasons text[] default array['current'],p_statuses text[] default array['open'],
  p_query text default '',p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid;pattern text;query_id uuid;result jsonb;
begin
  perform beta_private.require_league_view_admin();
  if p_seasons is null or cardinality(p_seasons)>32 or array_position(p_seasons,null) is not null
    or exists(select 1 from unnest(p_seasons)s where length(s)>40)
    or p_statuses is null or not(p_statuses <@ array['open','setup','drafting','active','complete','archived'])
    or array_position(p_statuses,null) is not null or p_query is null or length(p_query)>320
    or(p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid league filters' using errcode='22023';end if;
  current_id:=beta_private.league_view_current_season();
  pattern:='%'||replace(replace(replace(lower(btrim(p_query)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  query_id:=beta_private.operations_uuid(btrim(p_query));
  with matching as materialized (
    select id from public.leagues where p_query<>'' and(lower(name) like pattern or id=query_id)
    union select league_id from public.fantasy_teams where p_query<>'' and lower(name) like pattern
    union select m.league_id from public.league_members m join public.profiles p on p.id=m.user_id where p_query<>'' and p.deleted_at is null and lower(p.display_name) like pattern
    union select m.league_id from public.league_members m join auth.users u on u.id=m.user_id where p_query<>'' and lower(u.email) like pattern
  ), catalog as materialized(select * from beta_private.league_view_catalog()), filtered as materialized(
    select l.* from catalog l where (cardinality(p_seasons)=0 or l.season_label=any(p_seasons)
      or('current'=any(p_seasons) and l.season_id=current_id)
      or('previous'=any(p_seasons) and l.season_id is distinct from current_id and(l.season_id is null or exists(
        select 1 from public.fantasy_periods f where f.season_id=l.season_id and f.phase='regular'
          and f.starts_at<=(select min(starts_at) from public.fantasy_periods where season_id=current_id and phase='regular')))))
      and(cardinality(p_statuses)=0 or l.status::text=any(p_statuses) or('open'=any(p_statuses) and l.status in('setup','drafting','active')))
      and(p_query='' or l.id in(select id from matching))
  ), page as materialized(
    select l.*,coalesce(p.display_name,'Unavailable account') commissioner from filtered l
      left join public.profiles p on p.id=l.commissioner_id and p.deleted_at is null
    where p_before_at is null or(l.created_at,l.id)<(p_before_at,p_before_id) order by l.created_at desc,l.id desc limit 26
  ), visible as materialized(select * from page order by created_at desc,id desc limit 25),
  members as(select m.league_id,count(*) count from public.league_members m join visible v on v.id=m.league_id group by m.league_id)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('member_count',coalesce(m.count,0)) order by v.created_at desc,v.id desc)
    from visible v left join members m on m.league_id=v.id),'[]'),'filteredCount',(select count(*) from filtered),
    'totalCount',(select count(*) from catalog),'hasMore',(select count(*)>25 from page),
    'nextCursor',(select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1)) into result;
  return result;
end;$$;
create function public.admin_list_leagues_filtered(p_seasons text[] default array['current'],p_statuses text[] default array['open'],
  p_query text default '',p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select rpc_private.admin_list_leagues_filtered(p_seasons,p_statuses,p_query,p_before_at,p_before_id);$$;

-- - Keep old bookmarks and clients compatible while returning accurate matching totals
create or replace function rpc_private.admin_list_leagues(p_season text default 'current',p_status text default 'open',
  p_query text default '',p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
  select rpc_private.admin_list_leagues_filtered(case when p_season='all' then '{}'::text[] else array[p_season] end,
    case when p_status='all' then '{}'::text[] else array[p_status] end,p_query,p_before_at,p_before_id);
$$;
create or replace function rpc_private.admin_get_league_roster(p_league_id uuid,p_team_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform beta_private.require_league_view_admin();
  if not exists(select 1 from public.fantasy_teams where id=p_team_id and league_id=p_league_id)then raise exception 'Team unavailable in this league' using errcode='P0002';end if;
  return(select coalesce(jsonb_agg(to_jsonb(x) order by x.status,x.slot_code,x.id),'[]') from(
    select r.id,r.athlete_id,r.slot_code,r.status,a.display_name,a.position,a.jersey_number,c.name program_name,
      jsonb_build_object('headshot',a.bio->'headshot') bio
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id and a.fantasy_withdrawn_at is null
    join public.competitions c on c.id=a.competition_id join public.leagues l on l.id=r.league_id
    left join public.player_pools pool on pool.id=l.pool_id
    where r.league_id=p_league_id and r.fantasy_team_id=p_team_id and r.released_at is null
      and(l.pool_id is null or not exists(select 1 from public.athlete_seasons m where m.athlete_id=a.id and m.season_id=pool.season_id and not m.directory_visible))
    order by r.status,r.slot_code,r.id limit 100)x);
end;$$;

alter table public.preseason_ranking_entries add column display_data jsonb;

-- - Capture display evidence once without changing the existing combined rank calculations
create function beta_private.admin_ranking_inputs(p_pool_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(i.value||jsonb_build_object('display_data',jsonb_build_object(
    'name',a.display_name,'position',a.position,'program',c.division::text||'_'||sport.code::text,'division',c.division,
    'bio',jsonb_build_object('headshot',a.bio->'headshot'),'season_label',season.label,
    'games_played',summary.games_played,'stats',coalesce(summary.stats,'{}'),'sources',coalesce(summary.sources,'[]'),
    'supporting_statistics',case when history.records>0 then jsonb_build_object('season_label',history.season_label,
      'games_played',history.games_played,'fantasy_points',history.fantasy_points,'stats',coalesce(history.stats,'{}'))end))
    order by i.ordinality),'[]')
  from jsonb_array_elements(beta_private.preseason_ranking_inputs(p_pool_id)) with ordinality i(value,ordinality)
  join public.athletes a on a.id=(i.value->>'athlete_id')::uuid join public.player_pools pool on pool.id=p_pool_id
  join public.fantasy_seasons season on season.id=pool.season_id
  join public.athlete_seasons m on m.athlete_id=a.id and m.season_id=pool.season_id
  join public.competitions c on c.id=m.competition_id join public.sports sport on sport.id=c.sport_id
  left join lateral(
    select case when count(distinct s.games_played)=1 then min(s.games_played) end games_played,
      case when count(distinct s.stats::text)=1 then (jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(s.stats)
        where jsonb_typeof(value)='number' and key~'^[a-z_][a-z0-9_.]{0,40}$'))->0) end stats,
      jsonb_agg(s.source order by s.source) sources
    from public.athlete_season_summaries s where s.athlete_id=a.id and s.season_label=season.label and s.kind='supplied_projection'
  )summary on true
  left join lateral(
    select count(*) records,min(h.season_label) season_label,
      case when count(distinct h.games_played)=1 then min(h.games_played)end games_played,
      case when count(distinct h.fantasy_points)=1 then min(h.fantasy_points)end fantasy_points,
      case when count(distinct h.stats::text)=1 then(jsonb_agg((select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(h.stats)
        where jsonb_typeof(value)='number' and(key~'^[a-z_][a-z0-9_.]{0,40}$'or key~'^[0-9]{2}[-/][0-9]{2} [A-Za-z0-9 %/().+_-]{1,60}$')))->0)end stats
    from public.athlete_season_summaries h where h.athlete_id=a.id and h.kind='historical'
      and h.season_label=case when season.label~'^[0-9]{4}-[0-9]{2}$'then(left(season.label,4)::int-1)::text||'-'||substring(season.label,3,2)end
      and exists(select 1 from public.athlete_season_summaries supplied where supplied.athlete_id=a.id and supplied.season_label=season.label
        and supplied.kind='supplied_projection' and supplied.source=h.source and supplied.import_id is not distinct from h.import_id)
  )history on true;
$$;
create function rpc_private.admin_get_ranking_seasons() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid;current_label text;
begin
  perform beta_private.require_league_view_admin();current_id:=beta_private.league_view_current_season();
  select label into current_label from public.fantasy_seasons where id=current_id;
  return jsonb_build_object('currentSeason',current_label,'seasons',coalesce((select jsonb_agg(label order by label desc) from(
    select label from public.fantasy_seasons where label<=current_label
    union select season_label from public.competitions where season_label<=current_label and season_label~'^[0-9]{4}-[0-9]{2}$'
    union select season_label from public.athlete_season_summaries where season_label<=current_label and season_label~'^[0-9]{4}-[0-9]{2}$'
  )s),'[]'));
end;$$;
create function rpc_private.admin_get_ranking_review(p_season text default null,p_preview boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid;current_label text;selected_season_id uuid;pool uuid;publication public.preseason_ranking_publications%rowtype;rows jsonb;selected text;
begin
  perform beta_private.require_league_view_admin();current_id:=beta_private.league_view_current_season();
  select label into current_label from public.fantasy_seasons where id=current_id;selected:=coalesce(p_season,current_label);
  if current_label is null or selected is null then return jsonb_build_object('season',null,'rows','[]','publication',null,'canPublish',false);end if;
  if selected>current_label or not(rpc_private.admin_get_ranking_seasons()->'seasons' ? selected) or p_preview is null then raise exception 'Select the current or a previous season' using errcode='22023';end if;
  select id into selected_season_id from public.fantasy_seasons where label=selected;
  select p.id into pool from public.player_pools p where p.season_id=selected_season_id
    order by p.is_active desc,p.rankings_approved_at desc nulls last,p.id limit 1;
  if p_preview then
    if selected_season_id is distinct from current_id or not exists(select 1 from public.player_pools where id=pool and is_active) then
      raise exception 'Historical rankings are read only' using errcode='42501';end if;
    rows:=beta_private.admin_ranking_inputs(pool);
  else
    select * into publication from public.preseason_ranking_publications where pool_id=pool order by version desc limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('athlete_id',r.athlete_id,'name',coalesce(r.display_data->>'name',a.display_name),
      'position_group',r.position_group,'position_rank',r.position_rank,'projected_points',r.projected_points,
      'display_data',coalesce(r.display_data,jsonb_build_object('name',a.display_name,'position',a.position,'program',c.division::text||'_'||sport.code::text,
        'division',c.division,'season_label',selected,'bio',jsonb_build_object('headshot',a.bio->'headshot'))))
      order by r.position_group,r.position_rank nulls last,a.display_name,a.id),'[]') into rows
    from public.preseason_ranking_entries r join public.athletes a on a.id=r.athlete_id and a.fantasy_withdrawn_at is null
    join public.athlete_seasons m on m.athlete_id=a.id and m.season_id=selected_season_id and m.directory_visible
    join public.competitions c on c.id=m.competition_id join public.sports sport on sport.id=c.sport_id where r.publication_id=publication.id;
  end if;
  return jsonb_build_object('season',selected,'poolId',pool,'canPublish',selected_season_id=current_id and exists(select 1 from public.player_pools where id=pool and is_active),
    'preview',p_preview,'input_hash',case when p_preview then md5(rows::text) end,'rows',rows,
    'publication',case when publication.id is not null then jsonb_build_object('version',publication.version,'published_at',publication.published_at)end);
end;$$;

create function beta_private.publish_admin_ranking_review(p_pool_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text,p_enriched boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;expected text;publication uuid;next_version integer;
begin
  perform beta_private.require_league_view_admin();result:=beta_private.begin_command('publish_preseason_rankings',p_idempotency_key);if result is not null then return result;end if;
  if not exists(select 1 from public.player_pools where id=p_pool_id and is_active and season_id=beta_private.league_view_current_season())then
    raise exception 'Only current season rankings can be published' using errcode='42501';end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'Enter a review reason of 5 to 500 characters' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('preseason-rankings:'||p_pool_id,0));rows:=beta_private.admin_ranking_inputs(p_pool_id);
  if jsonb_array_length(rows)=0 then raise exception 'No approved directory athletes are available' using errcode='22023';end if;
  if p_enriched then expected:=md5(rows::text);else
    select md5(jsonb_agg(value-'display_data' order by ordinality)::text) into expected from jsonb_array_elements(rows) with ordinality;
  end if;
  if p_expected_hash is distinct from expected then raise exception 'Ranking inputs changed; preview and review again' using errcode='PT409';end if;
  select coalesce(max(version),0)+1 into next_version from public.preseason_ranking_publications where pool_id=p_pool_id;
  insert into public.preseason_ranking_publications(pool_id,version,input_hash,published_by,reason)
    values(p_pool_id,next_version,expected,auth.uid(),btrim(p_reason)) returning id into publication;
  insert into public.preseason_ranking_entries(publication_id,athlete_id,position_group,projected_points,position_rank,provenance,display_data)
    select publication,r.athlete_id,r.position_group,r.projected_points,r.position_rank,r.provenance,r.display_data from jsonb_to_recordset(rows)
      r(athlete_id uuid,position_group text,projected_points numeric,position_rank integer,provenance jsonb,display_data jsonb);
  perform beta_private.audit('rankings.published','ranking_publication',publication::text,null,jsonb_build_object('version',next_version),p_idempotency_key);
  return beta_private.finish_command('publish_preseason_rankings',p_idempotency_key,jsonb_build_object('publication_id',publication,'version',next_version));
end;$$;
create or replace function rpc_private.publish_preseason_rankings(p_pool_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb
language sql security definer set search_path='' as $$select beta_private.publish_admin_ranking_review(p_pool_id,p_expected_hash,p_reason,p_idempotency_key,false);$$;
create function rpc_private.admin_publish_preseason_review(p_pool_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb
language sql security definer set search_path='' as $$select beta_private.publish_admin_ranking_review(p_pool_id,p_expected_hash,p_reason,p_idempotency_key,true);$$;
create function public.admin_get_ranking_seasons() returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_ranking_seasons();$$;
create function public.admin_get_ranking_review(p_season text default null,p_preview boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_ranking_review(p_season,p_preview);$$;
create function public.admin_publish_preseason_review(p_pool_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.admin_publish_preseason_review(p_pool_id,p_expected_hash,p_reason,p_idempotency_key);$$;

do $$declare r record;begin
  for r in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where(n.nspname='beta_private' and p.proname in('admin_ranking_inputs','publish_admin_ranking_review'))
      or(n.nspname in('public','rpc_private') and p.proname in('admin_list_leagues_filtered','admin_get_ranking_seasons','admin_get_ranking_review','admin_publish_preseason_review')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
    if r.nspname in('public','rpc_private')then execute format('grant execute on function %s to authenticated',r.signature);end if;
  end loop;
end;$$;
notify pgrst,'reload schema';
