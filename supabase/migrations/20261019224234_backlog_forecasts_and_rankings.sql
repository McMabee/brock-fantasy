create function rpc_private.get_player_forecast(p_pool_id uuid,p_athlete_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare base jsonb; membership public.athlete_seasons%rowtype; season uuid;
begin
  perform rpc_private.require_app_access();
  base:=rpc_private.get_player_insights(p_pool_id,p_athlete_id)->0;
  if base is null then raise exception 'Player unavailable' using errcode='42501'; end if;
  select season_id into season from public.player_pools where id=p_pool_id and is_active;
  select * into membership from public.athlete_seasons where athlete_id=p_athlete_id and season_id=season;
  return jsonb_build_object('projectedSeasonPoints',base->'seasonProjection','projectedGames',base->'projectedGames',
    'knownSchedule',exists(select 1 from public.games g where g.competition_id=membership.competition_id and membership.team_id in(g.home_team_id,g.away_team_id) and g.schedule_kind in('regular','playoff')),
    'periods',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',number,'startsAt',starts_at,'endsAt',ends_at) order by number) from public.fantasy_periods where season_id=season),'[]'),
    'games',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'startsAt',g.starts_at,'status',g.status,'pending',not g.schedule_confirmed,
      'opponent',case when g.home_team_id=membership.team_id then away.name else home.name end,
      'complete',coalesce(s.complete,false),'actualPoints',case when s.complete then s.fantasy_points end) order by g.starts_at,g.id)
      from public.games g join public.teams home on home.id=g.home_team_id join public.teams away on away.id=g.away_team_id
      left join public.normalized_player_game_stats s on s.game_id=g.id and s.athlete_id=p_athlete_id
      where g.competition_id=membership.competition_id and membership.team_id in(g.home_team_id,g.away_team_id) and g.schedule_kind in('regular','playoff')),'[]'));
end $$;
create function public.get_player_forecast(p_pool_id uuid,p_athlete_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.get_player_forecast(p_pool_id,p_athlete_id); $$;

create table public.preseason_ranking_publications(
  id uuid primary key default gen_random_uuid(), pool_id uuid not null references public.player_pools(id),
  version integer not null, input_hash text not null, published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null, reason text not null,
  unique(pool_id,version)
);
create index preseason_ranking_latest on public.preseason_ranking_publications(pool_id,version desc);
create table public.preseason_ranking_entries(
  publication_id uuid not null references public.preseason_ranking_publications(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id), position_group text not null,
  projected_points numeric, position_rank integer, provenance jsonb not null,
  primary key(publication_id,position_group,athlete_id),
  check(position_group in('HK_F','HK_DG','BB_BC','BB_FC','VB_HT','VB_LS')),
  check((projected_points is null)=(position_rank is null))
);
create index preseason_ranking_athlete on public.preseason_ranking_entries(athlete_id);
alter table public.preseason_ranking_publications enable row level security;
alter table public.preseason_ranking_entries enable row level security;
revoke all on public.preseason_ranking_publications,public.preseason_ranking_entries from anon,authenticated;
grant select on public.preseason_ranking_publications,public.preseason_ranking_entries to authenticated;
grant all on public.preseason_ranking_publications,public.preseason_ranking_entries to service_role;
create policy ranking_publication_read on public.preseason_ranking_publications for select to authenticated using(public.can_use_app() and exists(select 1 from public.player_pools p where p.id=pool_id and p.is_active));
create policy ranking_entry_read on public.preseason_ranking_entries for select to authenticated using(public.can_use_app() and exists(select 1 from public.preseason_ranking_publications p join public.player_pools pool on pool.id=p.pool_id join public.athlete_seasons m on m.season_id=pool.season_id and m.athlete_id=preseason_ranking_entries.athlete_id join public.athletes a on a.id=m.athlete_id where p.id=publication_id and m.directory_visible and a.status='active' and a.fantasy_withdrawn_at is null));

-- - Keep ranking publication inputs separate from the draft's frozen ranking table
create function beta_private.preseason_ranking_inputs(pool uuid) returns jsonb language sql stable security definer set search_path='' as $$
with supplied as(
  select s.athlete_id,case when count(*)=count(s.fantasy_points) and count(distinct s.fantasy_points)=1 and bool_and(s.fantasy_points::text not in('NaN','Infinity','-Infinity')) then min(s.fantasy_points) end fp,
    jsonb_agg(jsonb_build_object('source',s.source,'updated_at',s.updated_at,'points',s.fantasy_points) order by s.source) provenance
  from public.athlete_season_summaries s join public.fantasy_seasons season on season.label=s.season_label join public.player_pools p on p.season_id=season.id
  where p.id=pool and s.kind='supplied_projection' group by s.athlete_id
), candidates as(
  select a.id athlete_id,a.display_name name,r.slot_code position_group,s.fp,s.provenance
  from public.player_pools p join public.pool_competitions pc on pc.pool_id=p.id
  join public.athlete_seasons m on m.season_id=p.season_id and m.competition_id=pc.competition_id
  join public.athletes a on a.id=m.athlete_id join public.roster_slot_rules r on r.ruleset_id=p.ruleset_id and r.allowed_positions&&m.positions
  left join supplied s on s.athlete_id=a.id where p.id=pool and p.is_active and m.directory_visible and a.status='active' and a.fantasy_withdrawn_at is null and r.slot_code in('HK_F','HK_DG','BB_BC','BB_FC','VB_HT','VB_LS')
), ranked as(select *,case when fp is not null then rank() over(partition by position_group order by fp desc nulls last) end position_rank from candidates)
select coalesce(jsonb_agg(jsonb_build_object('athlete_id',athlete_id,'name',name,'position_group',position_group,'projected_points',fp,'position_rank',position_rank,'provenance',coalesce(provenance,'[]')) order by position_group,position_rank nulls last,name,athlete_id),'[]') from ranked;
$$;
revoke all on function beta_private.preseason_ranking_inputs(uuid) from public,anon,authenticated,service_role;

create function rpc_private.preview_preseason_rankings(p_pool_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() then raise exception 'Administrator MFA required' using errcode='42501'; end if;
  rows:=beta_private.preseason_ranking_inputs(p_pool_id);
  return jsonb_build_object('rows',rows,'input_hash',md5(rows::text));
end $$;
create function public.preview_preseason_rankings(p_pool_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.preview_preseason_rankings(p_pool_id); $$;

create function rpc_private.publish_preseason_rankings(p_pool_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb; rows jsonb; snapshot uuid; next_version integer;
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() then raise exception 'Administrator MFA required' using errcode='42501'; end if;
  existing:=beta_private.begin_command('publish_preseason_rankings',p_idempotency_key); if existing is not null then return existing; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'A review reason between 5 and 500 characters is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('preseason-rankings:'||p_pool_id,0));
  rows:=beta_private.preseason_ranking_inputs(p_pool_id);
  if jsonb_array_length(rows)=0 then raise exception 'No approved directory athletes are available'; end if;
  if p_expected_hash is distinct from md5(rows::text) then raise exception 'Ranking inputs changed; preview and review again' using errcode='40001'; end if;
  select coalesce(max(version),0)+1 into next_version from public.preseason_ranking_publications where pool_id=p_pool_id;
  insert into public.preseason_ranking_publications(pool_id,version,input_hash,published_by,reason) values(p_pool_id,next_version,p_expected_hash,auth.uid(),btrim(p_reason)) returning id into snapshot;
  insert into public.preseason_ranking_entries(publication_id,athlete_id,position_group,projected_points,position_rank,provenance)
  select snapshot,r.athlete_id,r.position_group,r.projected_points,r.position_rank,r.provenance from jsonb_to_recordset(rows)r(athlete_id uuid,position_group text,projected_points numeric,position_rank integer,provenance jsonb);
  perform beta_private.audit('rankings.published','ranking_publication',snapshot::text,null,jsonb_build_object('version',next_version,'input_hash',p_expected_hash,'reason',p_reason),p_idempotency_key);
  return beta_private.finish_command('publish_preseason_rankings',p_idempotency_key,jsonb_build_object('publication_id',snapshot,'version',next_version));
end $$;
create function public.publish_preseason_rankings(p_pool_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.publish_preseason_rankings(p_pool_id,p_expected_hash,p_reason,p_idempotency_key); $$;

create function rpc_private.get_preseason_rankings(p_pool_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare publication public.preseason_ranking_publications%rowtype;
begin
  perform rpc_private.require_app_access();
  select s.* into publication from public.preseason_ranking_publications s join public.player_pools p on p.id=s.pool_id and p.is_active where s.pool_id=p_pool_id order by s.version desc limit 1;
  if publication.id is null then return jsonb_build_object('publication',null,'rows','[]'::jsonb); end if;
  return jsonb_build_object('publication',jsonb_build_object('version',publication.version,'published_at',publication.published_at),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('athlete_id',a.id,'name',a.display_name,'position',a.position,'program',coalesce(a.bio->>'program',c.name),'position_group',r.position_group,'projected_points',r.projected_points,'position_rank',r.position_rank) order by r.position_group,r.position_rank nulls last,a.display_name,a.id)
    from public.preseason_ranking_entries r join public.athletes a on a.id=r.athlete_id join public.player_pools p on p.id=p_pool_id
    join public.athlete_seasons m on m.athlete_id=a.id and m.season_id=p.season_id join public.competitions c on c.id=m.competition_id
    where r.publication_id=publication.id and a.status='active' and a.fantasy_withdrawn_at is null and m.directory_visible),'[]'));
end $$;
create function public.get_preseason_rankings(p_pool_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.get_preseason_rankings(p_pool_id); $$;
revoke all on function rpc_private.get_player_forecast(uuid,uuid),public.get_player_forecast(uuid,uuid),rpc_private.preview_preseason_rankings(uuid),public.preview_preseason_rankings(uuid),rpc_private.publish_preseason_rankings(uuid,text,text,text),public.publish_preseason_rankings(uuid,text,text,text),rpc_private.get_preseason_rankings(uuid),public.get_preseason_rankings(uuid) from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_player_forecast(uuid,uuid),public.get_player_forecast(uuid,uuid),rpc_private.preview_preseason_rankings(uuid),public.preview_preseason_rankings(uuid),rpc_private.publish_preseason_rankings(uuid,text,text,text),public.publish_preseason_rankings(uuid,text,text,text),rpc_private.get_preseason_rankings(uuid),public.get_preseason_rankings(uuid) to authenticated;
notify pgrst,'reload schema';
