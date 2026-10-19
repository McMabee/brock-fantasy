create table public.historical_game_log_batches (
  id uuid primary key default gen_random_uuid(), input_hash text unique not null,
  records jsonb not null, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), published_at timestamptz, reason text
);
create table public.athlete_historical_game_logs (
  athlete_id uuid not null references public.athletes(id), season_label text not null check(season_label='2025-26'),
  program text not null, source_game_id text not null, played_at timestamptz not null,
  phase text not null check(phase in('regular','playoff')), opponent text not null, result text not null,
  stats jsonb not null, positions text[] not null, fantasy_points numeric,
  complete boolean not null, missing_stats text[] not null, source_url text not null, source_hash text not null,
  identity_evidence jsonb not null, scoring_version text not null,
  batch_id uuid not null references public.historical_game_log_batches(id), updated_at timestamptz not null default now(),
  primary key(athlete_id,season_label,program,source_game_id), check(complete=(fantasy_points is not null))
);
create index historical_game_log_date on public.athlete_historical_game_logs(athlete_id,season_label,played_at desc);
alter table public.historical_game_log_batches enable row level security;
alter table public.athlete_historical_game_logs enable row level security;
revoke all on public.historical_game_log_batches,public.athlete_historical_game_logs from anon,authenticated;
grant select on public.historical_game_log_batches,public.athlete_historical_game_logs to authenticated;
grant all on public.historical_game_log_batches,public.athlete_historical_game_logs to service_role;
create policy historical_batches_admin on public.historical_game_log_batches for select to authenticated using(public.current_user_is_admin());
create policy historical_logs_visible on public.athlete_historical_game_logs for select to authenticated using(public.can_use_app() and exists(
  select 1 from public.athletes a join public.athlete_seasons m on m.athlete_id=a.id join public.fantasy_seasons s on s.id=m.season_id
  where a.id=athlete_historical_game_logs.athlete_id and a.status='active' and a.fantasy_withdrawn_at is null and m.directory_visible and s.label='2026-27'));

-- - Validate official identity lineage and calculate archival scores without touching live scoring
create function beta_private.prepare_historical_game_log(item jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.athletes%rowtype; positions text[]; sport public.sport_code;
  points numeric; missing text[]; version text; rules uuid:='b0000000-0000-4000-8000-000000000004';
begin
    select matchup_config->>'scoringSemantics' into strict version from public.scoring_rulesets where id=rules;
    select * into a from public.athletes where id=(item->>'athlete_id')::uuid and status='active' and fantasy_withdrawn_at is null;
    if a.id is null or not exists(select 1 from public.athlete_seasons m join public.fantasy_seasons s on s.id=m.season_id where m.athlete_id=a.id and m.directory_visible and s.label='2026-27') then raise exception 'Historical athlete is unavailable'; end if;
    if item->>'program' is distinct from a.bio->>'program' or item->>'program' not in('mens_hockey','womens_hockey','mens_basketball','womens_basketball','mens_volleyball','womens_volleyball') then raise exception 'Historical program does not match the current verified athlete'; end if;
    if item->>'season_label' is distinct from '2025-26' or coalesce(item->>'phase','') not in('regular','playoff')
      or not coalesce((item->>'played_at')::timestamptz>='2025-08-01'::timestamptz and (item->>'played_at')::timestamptz<'2026-08-01'::timestamptz,false)
      or coalesce(item->>'source_url','') !~ '^https://gobadgers[.]ca/sports/[a-z-]+/stats/2025-26/[a-z0-9-]+/boxscore/[0-9]+$'
      or coalesce(item->>'source_game_id','') !~ '^[0-9]+$' or item->>'source_game_id' is distinct from substring(item->>'source_url' from '/boxscore/([0-9]+)$')
      or coalesce(item->>'source_hash','') !~ '^[0-9a-f]{64}$'
      or char_length(coalesce(item->>'opponent','')) not between 1 and 200 or char_length(coalesce(item->>'result','')) not between 1 and 100
      then raise exception 'Invalid official archival source or appearance'; end if;
    if item#>>'{identity_evidence,basis}' is distinct from 'official_career_link'
      or item#>>'{identity_evidence,current_profile_url}' is distinct from a.bio#>>'{headshot,sourceUrl}'
      or coalesce(item#>>'{identity_evidence,current_profile_url}','') !~ '^https://gobadgers[.]ca/sports/[a-z-]+/roster/[a-z0-9-]+/[0-9]+$'
      or coalesce(item#>>'{identity_evidence,historical_player_id}','') !~ '^[0-9]+$'
      or coalesce(item#>>'{identity_evidence,career_source_hash}','') !~ '^[0-9a-f]{64}$'
      or coalesce(item#>>'{identity_evidence,position_source_hash}','') !~ '^[0-9a-f]{64}$'
      then raise exception 'Verified official career identity evidence is required'; end if;
    sport:=case when item->>'program' like '%hockey' then 'hockey' when item->>'program' like '%basketball' then 'basketball' else 'volleyball' end;
    select array_agg(value order by value) into positions from jsonb_array_elements_text(item->'positions');
    if coalesce(cardinality(positions),0)=0 or not positions<@(case sport when 'hockey' then array['F','D','G'] when 'basketball' then array['BC','FC'] else array['HT','L','S'] end)
      or jsonb_typeof(item->'stats') is distinct from 'object' then raise exception 'Official historical positions and statistics are required'; end if;
    select sum(x.points),coalesce(array_agg(replace(x.stat_key,'__missing__:','')) filter(where not x.complete),'{}') into points,missing
      from beta_private.score_beta_stat_line(rules,sport,positions,item->'stats') x;
    return item||jsonb_build_object('athlete_name',a.display_name,'positions',positions,'complete',cardinality(missing)=0,'missing_stats',missing,'fantasy_points',case when cardinality(missing)=0 then points end,'scoring_version',version);
end $$;
create function beta_private.prepare_historical_game_logs(p_records jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb;
begin
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 5000 or octet_length(p_records::text)>10000000 then raise exception 'Supply 1 to 5000 archival appearances within 10 MB'; end if;
  select jsonb_agg(beta_private.prepare_historical_game_log(value) order by value->>'athlete_id',value->>'program',value->>'source_game_id') into prepared from jsonb_array_elements(p_records);
  if exists(select 1 from jsonb_array_elements(prepared) r group by r->>'athlete_id',r->>'program',r->>'source_game_id' having count(*)>1) then raise exception 'Duplicate archival appearance'; end if;
  return prepared;
end $$;
revoke all on function beta_private.prepare_historical_game_log(jsonb) from public,anon,authenticated,service_role;
revoke all on function beta_private.prepare_historical_game_logs(jsonb) from public,anon,authenticated,service_role;

create function rpc_private.stage_historical_game_logs(p_records jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb; hash text; batch uuid;
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() then raise exception 'Administrator MFA required' using errcode='42501'; end if;
  prepared:=beta_private.prepare_historical_game_logs(p_records); hash:=md5(prepared::text);
  insert into public.historical_game_log_batches(input_hash,records,created_by) values(hash,prepared,auth.uid()) on conflict(input_hash) do update set input_hash=excluded.input_hash returning id into batch;
  return jsonb_build_object('batch_id',batch,'input_hash',hash,'rows',prepared);
end $$;
create function public.stage_historical_game_logs(p_records jsonb) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.stage_historical_game_logs(p_records);$$;
create function rpc_private.publish_historical_game_logs(p_batch_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.historical_game_log_batches%rowtype; receipt jsonb; prepared jsonb;
begin
  perform rpc_private.require_app_access();
  if not public.current_user_is_admin() then raise exception 'Administrator MFA required' using errcode='42501'; end if;
  receipt:=beta_private.begin_command('publish_historical_game_logs',p_idempotency_key); if receipt is not null then return receipt; end if;
  select * into b from public.historical_game_log_batches where id=p_batch_id for update;
  if b.id is null or b.input_hash is distinct from p_expected_hash then raise exception 'Historical review batch changed; stage and review again' using errcode='40001'; end if;
  if char_length(coalesce(btrim(p_reason),'')) not between 5 and 500 then raise exception 'A review reason between 5 and 500 characters is required'; end if;
  if b.published_at is null then
    perform pg_advisory_xact_lock(hashtextextended('historical-game-logs:2025-26',0));
    prepared:=beta_private.prepare_historical_game_logs(b.records);
    if md5(prepared::text) is distinct from b.input_hash then raise exception 'Historical scoring inputs changed; stage and review again' using errcode='40001'; end if;
    insert into public.athlete_historical_game_logs(athlete_id,season_label,program,source_game_id,played_at,phase,opponent,result,stats,positions,fantasy_points,complete,missing_stats,source_url,source_hash,identity_evidence,scoring_version,batch_id)
    select r.athlete_id,r.season_label,r.program,r.source_game_id,r.played_at,r.phase,r.opponent,r.result,r.stats,r.positions,r.fantasy_points,r.complete,r.missing_stats,r.source_url,r.source_hash,r.identity_evidence,r.scoring_version,b.id
    from jsonb_to_recordset(prepared)r(athlete_id uuid,season_label text,program text,source_game_id text,played_at timestamptz,phase text,opponent text,result text,stats jsonb,positions text[],fantasy_points numeric,complete boolean,missing_stats text[],source_url text,source_hash text,identity_evidence jsonb,scoring_version text)
    on conflict(athlete_id,season_label,program,source_game_id) do update set played_at=excluded.played_at,phase=excluded.phase,opponent=excluded.opponent,result=excluded.result,stats=excluded.stats,positions=excluded.positions,fantasy_points=excluded.fantasy_points,complete=excluded.complete,missing_stats=excluded.missing_stats,source_url=excluded.source_url,source_hash=excluded.source_hash,identity_evidence=excluded.identity_evidence,scoring_version=excluded.scoring_version,batch_id=excluded.batch_id,updated_at=now();
    update public.historical_game_log_batches set published_at=now(),reason=btrim(p_reason) where id=b.id;
    perform beta_private.audit('history.published','historical_batch',b.id::text,null,jsonb_build_object('input_hash',b.input_hash,'count',jsonb_array_length(b.records),'reason',p_reason),p_idempotency_key);
  end if;
  return beta_private.finish_command('publish_historical_game_logs',p_idempotency_key,jsonb_build_object('batch_id',b.id,'published_count',jsonb_array_length(b.records)));
end $$;
create function public.publish_historical_game_logs(p_batch_id uuid,p_expected_hash text,p_reason text,p_idempotency_key text) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.publish_historical_game_logs(p_batch_id,p_expected_hash,p_reason,p_idempotency_key);$$;
create function rpc_private.get_historical_game_logs(p_athlete_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  if not exists(select 1 from public.athletes a join public.athlete_seasons m on m.athlete_id=a.id join public.fantasy_seasons s on s.id=m.season_id where a.id=p_athlete_id and a.status='active' and a.fantasy_withdrawn_at is null and m.directory_visible and s.label='2026-27') then raise exception 'Player unavailable' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)-'identity_evidence' order by played_at desc,source_game_id) from public.athlete_historical_game_logs r where athlete_id=p_athlete_id),'[]');
end $$;
create function public.get_historical_game_logs(p_athlete_id uuid) returns jsonb language sql security invoker set search_path='' as $$select rpc_private.get_historical_game_logs(p_athlete_id);$$;
revoke all on function rpc_private.stage_historical_game_logs(jsonb),public.stage_historical_game_logs(jsonb),rpc_private.publish_historical_game_logs(uuid,text,text,text),public.publish_historical_game_logs(uuid,text,text,text),rpc_private.get_historical_game_logs(uuid),public.get_historical_game_logs(uuid) from public,anon,authenticated,service_role;
grant execute on function rpc_private.stage_historical_game_logs(jsonb),public.stage_historical_game_logs(jsonb),rpc_private.publish_historical_game_logs(uuid,text,text,text),public.publish_historical_game_logs(uuid,text,text,text),rpc_private.get_historical_game_logs(uuid),public.get_historical_game_logs(uuid) to authenticated;
notify pgrst,'reload schema';
