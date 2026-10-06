-- Additive beta model. Existing single-competition leagues remain readable and retain their rules.
create schema if not exists beta_private;
revoke all on schema beta_private from public, anon, authenticated;
grant usage on schema beta_private to service_role;
alter default privileges in schema beta_private revoke execute on functions from public;

alter table public.scoring_rulesets alter column sport drop not null;
alter table public.scoring_rules add column sport public.sport_code;
alter table public.scoring_rules add column player_role text;
create table public.fantasy_seasons (
  id uuid primary key default gen_random_uuid(), label text not null unique,
  timezone text not null default 'America/Toronto', rule_version text not null,
  status text not null default 'draft' check (status in ('draft','active','complete')),
  trade_deadline timestamptz not null, created_at timestamptz not null default now()
);
create table public.player_pools (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.fantasy_seasons(id),
  name text not null, ruleset_id uuid not null references public.scoring_rulesets(id),
  is_active boolean not null default false, rankings_version integer not null default 1,
  rankings_approved_at timestamptz, rankings_approved_by uuid references public.profiles(id),
  scoring_paused boolean not null default false, state_version bigint not null default 1,
  unique(season_id, name)
);
create table public.pool_competitions (
  pool_id uuid not null references public.player_pools(id), competition_id uuid not null references public.competitions(id),
  primary key(pool_id,competition_id)
);
create table public.athlete_seasons (
  id uuid primary key default gen_random_uuid(), athlete_id uuid not null references public.athletes(id),
  season_id uuid not null references public.fantasy_seasons(id), competition_id uuid not null references public.competitions(id),
  team_id uuid not null references public.teams(id), positions text[] not null check (cardinality(positions)>0 and positions <@ array['F','D','G','BC','FC','HT','S','L']),
  draft_eligible boolean not null default true, curated boolean not null default false,
  source_key text, updated_at timestamptz not null default now(), unique(athlete_id,season_id)
);
create table public.fantasy_periods (
  id uuid primary key default gen_random_uuid(), season_id uuid not null references public.fantasy_seasons(id),
  number integer not null check(number between 1 and 10), starts_at timestamptz not null, ends_at timestamptz not null,
  phase text not null check(phase in ('regular','semifinal','final')), unique(season_id,number), check(starts_at<ends_at)
);
create table public.source_imports (
  id uuid primary key default gen_random_uuid(), source text not null, source_hash text not null,
  season_id uuid references public.fantasy_seasons(id), kind text not null,
  payload jsonb not null, issues jsonb not null default '[]', status text not null default 'preview' check(status in ('preview','published','rejected')),
  imported_by uuid references public.profiles(id), created_at timestamptz not null default now(), published_at timestamptz,
  unique(source,source_hash)
);
create table public.source_rows (
  import_id uuid not null references public.source_imports(id), row_number integer not null,
  source_key text not null, raw jsonb not null, normalized jsonb, entity_id uuid,
  primary key(import_id,row_number)
);
create table public.athlete_season_summaries (
  athlete_id uuid not null references public.athletes(id), season_label text not null,
  source text not null, fantasy_points numeric, games_played numeric, stats jsonb not null default '{}',
  kind text not null check(kind in ('historical','supplied_projection','previous_team')),
  import_id uuid references public.source_imports(id), updated_at timestamptz not null default now(),
  primary key(athlete_id,season_label,source,kind)
);
create table public.pool_rankings (
  pool_id uuid not null references public.player_pools(id), athlete_id uuid not null references public.athletes(id),
  rank integer not null check(rank>0), reviewed boolean not null default false,
  basis text not null default 'Needs review', primary key(pool_id,athlete_id), unique(pool_id,rank) deferrable initially immediate
);
create table public.weekly_projections (
  athlete_id uuid not null references public.athletes(id), period_id uuid not null references public.fantasy_periods(id),
  model_version text not null, rule_version text not null, input_cutoff timestamptz not null,
  generated_at timestamptz not null default now(), points numeric, provenance jsonb not null default '{}',
  status text not null default 'unavailable' check(status in ('unavailable','ready')),
  primary key(athlete_id,period_id,model_version,input_cutoff), check((status='ready')=(points is not null))
);
alter table public.leagues alter column competition_id drop not null;
alter table public.leagues add column pool_id uuid references public.player_pools(id);
alter table public.leagues add constraint league_model check(competition_id is not null or pool_id is not null);
alter table public.leagues add constraint beta_league_size check(pool_id is null or (max_members in (4,6,8,10) and format='head_to_head'));
alter table public.fantasy_teams add column preseason_order integer;
alter table public.drafts drop constraint drafts_league_id_key;
alter table public.drafts add column voided_at timestamptz;
alter table public.drafts add column is_test boolean not null default true;
alter table public.drafts add column league_size integer;
alter table public.drafts add column ranking_version integer;
alter table public.drafts add column rankings_snapshot jsonb;
alter table public.drafts add column remaining_seconds integer;
create unique index one_current_draft on public.drafts(league_id) where voided_at is null;
alter table public.games add column home_score integer check(home_score>=0);
alter table public.games add column away_score integer check(away_score>=0);
alter table public.games add column state_version bigint not null default 1;
alter table public.games add column lineup_lock_at timestamptz;
update public.games set lineup_lock_at=starts_at;
alter table public.games add column stats_complete boolean not null default false;
alter table public.games add column manual_override boolean not null default false;
alter table public.games add column source_updated_at timestamptz;
alter table public.games add column source_url text;
alter table public.normalized_player_game_stats add column fantasy_points numeric;
alter table public.normalized_player_game_stats add column complete boolean not null default false;
alter table public.normalized_player_game_stats add column missing_stats text[] not null default '{}';
alter table public.matchups add column stage text not null default 'regular' check(stage in ('regular','semifinal','championship','third','placement'));
alter table public.matchups add column winner_team_id uuid references public.fantasy_teams(id);
alter table public.matchups add column home_seed integer;
alter table public.matchups add column away_seed integer;
create table public.roster_slot_history (
  id bigint generated always as identity primary key, roster_entry_id uuid not null references public.roster_entries(id),
  slot_code text not null, status public.roster_status not null, effective_at timestamptz not null default now()
);
insert into public.roster_slot_history(roster_entry_id,slot_code,status,effective_at)
select id,slot_code,status,acquired_at from public.roster_entries;
create table public.period_lineup_locks (
  league_id uuid not null references public.leagues(id), fantasy_team_id uuid not null references public.fantasy_teams(id),
  period_id uuid not null references public.fantasy_periods(id), athlete_id uuid not null references public.athletes(id),
  roster_entry_id uuid not null references public.roster_entries(id), slot_code text not null,
  status public.roster_status not null, locked_at timestamptz not null,
  primary key(fantasy_team_id,period_id,athlete_id)
);
alter table public.trades add column review_ends_at timestamptz;
alter table public.trades add column execution_status text not null default 'pending' check(execution_status in ('pending','review','locked','vetoed','conflicted','completed'));
alter table public.trades add column completed_at timestamptz;
create table public.trade_votes (
  trade_id uuid not null references public.trades(id), user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), primary key(trade_id,user_id)
);
create table public.scoring_jobs (
  game_id uuid primary key references public.games(id), source_identity text not null,
  status text not null default 'pending' check(status in ('pending','running','failed','complete')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  last_error text, updated_at timestamptz not null default now()
);
create table public.operational_jobs (
  name text primary key, enabled boolean not null default true, last_started_at timestamptz,
  last_finished_at timestamptz, next_run_at timestamptz not null default now(), last_error text, attempts integer not null default 0
);
create table beta_private.rate_limits (
  key_hash text not null, window_start timestamptz not null, requests integer not null,
  primary key(key_hash,window_start)
);
create index athlete_seasons_pool_lookup on public.athlete_seasons(season_id,competition_id,draft_eligible);
create index athlete_seasons_team on public.athlete_seasons(team_id);
create index games_lock_lookup on public.games(competition_id,lineup_lock_at);
create index games_start_lookup on public.games(competition_id,starts_at);
create index slot_history_at on public.roster_slot_history(roster_entry_id,effective_at desc,id desc);
create index period_locks_league on public.period_lineup_locks(league_id,period_id);
create index draft_adp_completed on public.drafts(completed_at) where status='complete' and voided_at is null and not is_test;
create index fantasy_periods_at on public.fantasy_periods(season_id,starts_at,ends_at);
create index scoring_jobs_due on public.scoring_jobs(next_attempt_at) where status in ('pending','failed');

-- Approved coefficients; pool activation remains gated on data and ranking review.
insert into public.scoring_rulesets(id,sport,name,version,status,approved_at,draft_config,transaction_config,matchup_config)
values('b0000000-0000-4000-8000-000000000001',null,'Brock combined 2026.1',1,'approved',now(),
  '{"pickSeconds":120,"autopickStrategy":"queued_then_weighted_legal"}',
  '{"freeAgentsEnabled":true,"waiversEnabled":true,"tradesEnabled":true}',
  '{"explicitPeriods":true,"tiesAllowed":true,"tiebreaker":"head_to_head_then_points"}');
insert into public.fantasy_seasons(id,label,rule_version,trade_deadline)
values('b0000000-0000-4000-8000-000000000002','2026-27','brock-2026.1','2027-01-23T17:00:00Z');
insert into public.player_pools(id,season_id,name,ruleset_id)
values('b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002','Brock six-program player pool','b0000000-0000-4000-8000-000000000001');
insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
select 'b0000000-0000-4000-8000-000000000001',code,label,positions,n,starter from (values
 ('HK_F','Hockey forward',array['F'],1,true),('HK_DG','Hockey defence / goalie',array['D','G'],1,true),
 ('BB_BC','Basketball back court',array['BC'],1,true),('BB_FC','Basketball front court',array['FC'],1,true),
 ('VB_HT','Volleyball hitter',array['HT'],1,true),('VB_LS','Volleyball libero / setter',array['L','S'],1,true),
 ('BN','Bench',array['F','D','G','BC','FC','HT','L','S'],4,false)) as v(code,label,positions,n,starter);
insert into public.scoring_rules(ruleset_id,stat_key,label,points,sport,player_role)
select 'b0000000-0000-4000-8000-000000000001',role||'.'||key,replace(key,'_',' '),points,sport::public.sport_code,role from (values
 ('hockey','skater','goals',20),('hockey','skater','assists',10),('hockey','skater','power_play_goals',5),('hockey','skater','short_handed_goals',5),('hockey','skater','penalty_minutes',-1),('hockey','skater','multi_point',5),
 ('hockey','goalie','wins',10),('hockey','goalie','goals_allowed',-2),('hockey','goalie','saves',0.4),('hockey','goalie','shutouts',15),
 ('basketball','basketball','points',1),('basketball','basketball','offensive_rebounds',1.5),('basketball','basketball','defensive_rebounds',1),('basketball','basketball','assists',1),('basketball','basketball','blocks',2),('basketball','basketball','steals',2),('basketball','basketball','turnovers',-2),('basketball','basketball','fouls',-1),('basketball','basketball','foul_out',-3),('basketball','basketball','double_double',2),
 ('volleyball','volleyball','kills',2),('volleyball','volleyball','aces',2),('volleyball','volleyball','solo_blocks',1.5),('volleyball','volleyball','assisted_blocks',1),('volleyball','volleyball','assists',0.25),('volleyball','volleyball','digs',0.25),('volleyball','volleyball','errors',-1),('volleyball','volleyball','hitter_bonus',2),('volleyball','volleyball','setter_bonus',4),('volleyball','volleyball','libero_bonus',8)) v(sport,role,key,points);
insert into public.fantasy_periods(season_id,number,starts_at,ends_at,phase)
select 'b0000000-0000-4000-8000-000000000002',n,s::timestamptz,e::timestamptz,case when n<9 then 'regular' when n=9 then 'semifinal' else 'final' end from (values
 (1,'2026-10-24T04:00:00Z','2026-11-01T04:00:00Z'),(2,'2026-11-01T04:00:00Z','2026-11-14T05:00:00Z'),
 (3,'2026-11-14T05:00:00Z','2026-11-22T05:00:00Z'),(4,'2026-11-22T05:00:00Z','2026-11-30T05:00:00Z'),
 (5,'2027-01-08T05:00:00Z','2027-01-15T05:00:00Z'),(6,'2027-01-15T05:00:00Z','2027-01-23T05:00:00Z'),
 (7,'2027-01-23T05:00:00Z','2027-01-29T05:00:00Z'),(8,'2027-01-29T05:00:00Z','2027-02-06T05:00:00Z'),
 (9,'2027-02-06T05:00:00Z','2027-02-13T05:00:00Z'),(10,'2027-02-13T05:00:00Z','2027-02-21T05:00:00Z'))v(n,s,e);

-- Explicit grants and RLS. No new client table permits direct mutation.
do $$ declare t text; begin
  foreach t in array array['fantasy_seasons','player_pools','pool_competitions','athlete_seasons','fantasy_periods','source_imports','source_rows','athlete_season_summaries','pool_rankings','weekly_projections','roster_slot_history','period_lineup_locks','trade_votes','scoring_jobs','operational_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['fantasy_seasons','player_pools','pool_competitions','fantasy_periods'] loop
    execute format('create policy beta_catalog_read on public.%I for select to authenticated using (true)',t);
  end loop;
  foreach t in array array['source_imports','source_rows','scoring_jobs','operational_jobs'] loop
    execute format('create policy beta_admin_read on public.%I for select to authenticated using (public.current_user_is_admin())',t);
  end loop;
end $$;
create policy beta_memberships_read on public.athlete_seasons for select to authenticated using (
  public.current_user_is_admin() or exists(select 1 from public.player_pools p join public.pool_competitions pc on pc.pool_id=p.id where p.is_active and p.season_id=athlete_seasons.season_id and pc.competition_id=athlete_seasons.competition_id));
create policy beta_history_read on public.athlete_season_summaries for select to authenticated using (exists(select 1 from public.athletes a where a.id=athlete_id));
create policy beta_ranks_read on public.pool_rankings for select to authenticated using (public.current_user_is_admin() or exists(select 1 from public.player_pools p where p.id=pool_id and p.is_active));
create policy beta_projection_read on public.weekly_projections for select to authenticated using (exists(select 1 from public.athletes a where a.id=athlete_id));
create policy beta_roster_history_read on public.roster_slot_history for select to authenticated using (exists(select 1 from public.roster_entries r where r.id=roster_entry_id and public.is_league_member(r.league_id)));
create policy beta_locks_read on public.period_lineup_locks for select to authenticated using (public.is_league_member(league_id));
create policy beta_votes_read on public.trade_votes for select to authenticated using (exists(select 1 from public.trades t where t.id=trade_id and public.is_league_member(t.league_id)));
create policy beta_trades_league_read on public.trades for select to authenticated using(public.is_league_member(league_id));
create policy beta_trade_items_league_read on public.trade_items for select to authenticated using(exists(select 1 from public.trades t where t.id=trade_id and public.is_league_member(t.league_id)));

create function beta_private.track_roster_slot() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' or new.slot_code is distinct from old.slot_code or new.status is distinct from old.status then
    insert into public.roster_slot_history(roster_entry_id,slot_code,status,effective_at) values(new.id,new.slot_code,new.status,case when tg_op='INSERT' then new.acquired_at else clock_timestamp() end);
  end if;
  return new;
end $$;
create trigger beta_slot_history after insert or update on public.roster_entries for each row execute function beta_private.track_roster_slot();
create function beta_private.game_lock_time() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.lineup_lock_at:=case when new.status in ('cancelled','postponed') then null else new.starts_at end;
  elsif old.lineup_lock_at is null or old.lineup_lock_at>clock_timestamp() then
    new.lineup_lock_at:=case when new.status in ('cancelled','postponed') then null else new.starts_at end;
  else new.lineup_lock_at:=old.lineup_lock_at;
  end if;
  return new;
end $$;
create trigger beta_game_lock before insert or update on public.games for each row execute function beta_private.game_lock_time();

create function beta_private.require_user() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); begin
  if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null) then raise exception 'Verified authentication required' using errcode='42501'; end if;
  if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=u) then raise exception 'Session has been revoked' using errcode='42501'; end if;
  return u;
end $$;
create function beta_private.begin_command(command text, request_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=beta_private.require_user(); result jsonb; begin
  if request_key is null or char_length(request_key) not between 8 and 200 then raise exception 'Invalid idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||':'||command||':'||request_key,0));
  select response into result from public.idempotency_keys where user_id=u and idempotency_keys.command=begin_command.command and idempotency_key=request_key;
  return result;
end $$;
create function beta_private.finish_command(command text, request_key text, result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  insert into public.idempotency_keys(user_id,command,idempotency_key,response) values(auth.uid(),command,request_key,result);
  return result;
end $$;
create function beta_private.league_lock(league uuid) returns void language sql volatile set search_path='' as $$ select pg_advisory_xact_lock(hashtextextended('beta-league:'||league::text,0)); $$;
create function beta_private.audit(action text, kind text, entity text, before_value jsonb, after_value jsonb, request_key text default null)
returns void language sql security definer set search_path='' as $$
insert into public.audit_log(actor_id,action,entity_type,entity_id,before_state,after_state,request_id) values(auth.uid(),action,kind,entity,before_value,after_value,request_key);
$$;
create function public.consume_rate_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; w timestamptz; begin
  if p_limit not between 1 and 10000 or p_seconds not between 1 and 86400 then raise exception 'Invalid rate policy'; end if;
  w:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_seconds)*p_seconds);
  insert into beta_private.rate_limits values(encode(extensions.digest(p_key,'sha256'),'hex'),w,1)
  on conflict(key_hash,window_start) do update set requests=beta_private.rate_limits.requests+1 returning requests into n;
  delete from beta_private.rate_limits where window_start<now()-interval '2 days';
  return n<=p_limit;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;

create function beta_private.match_slot(idx integer, candidates jsonb, slots jsonb, owners jsonb, seen text[])
returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb; s jsonb:=slots->idx; result jsonb; previous integer; visited text[]:=seen;
begin
  for c in select value from jsonb_array_elements(candidates) loop
    if c->>'id'=any(visited) or (c->>'owner' is not null and c->>'owner'<>s->>'team')
      or not exists(select 1 from jsonb_array_elements_text(c->'positions') p where s->'positions' ? p) then continue; end if;
    visited:=array_append(visited,c->>'id'); previous:=(owners->>(c->>'id'))::integer;
    if previous is null then return owners||jsonb_build_object(c->>'id',idx); end if;
    result:=beta_private.match_slot(previous,candidates,slots,owners,visited);
    if result is not null then return result||jsonb_build_object(c->>'id',idx); end if;
  end loop;
  return null;
end $$;
create function beta_private.draft_completion(league uuid, chosen uuid default null, chosen_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare candidates jsonb; slots jsonb; owners jsonb:='{}'::jsonb; begin
  select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,'owner',case when a.athlete_id=chosen then chosen_team else r.fantasy_team_id end) order by (r.fantasy_team_id is null),a.athlete_id)
  into candidates from public.leagues l join public.player_pools p on p.id=l.pool_id
  join public.pool_competitions pc on pc.pool_id=p.id join public.athlete_seasons a on a.competition_id=pc.competition_id and a.season_id=p.season_id and a.draft_eligible
  left join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.released_at is null where l.id=league;
  select jsonb_agg(jsonb_build_object('team',t.id,'code',sr.slot_code,'positions',sr.allowed_positions) order by sr.is_starter desc,t.id,sr.slot_code,n)
  into slots from public.fantasy_teams t join public.leagues l on l.id=t.league_id join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id
  cross join lateral generate_series(1,sr.slot_count)n where l.id=league;
  if candidates is null or slots is null or jsonb_array_length(candidates)<jsonb_array_length(slots) then return null; end if;
  for i in 0..jsonb_array_length(slots)-1 loop
    owners:=beta_private.match_slot(i,candidates,slots,owners,'{}'); if owners is null then return null; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(candidates)c where c->>'owner' is not null and not (owners ? (c->>'id'))) then return null; end if;
  return jsonb_build_object('owners',owners,'slots',slots);
end $$;
create function public.create_beta_league(p_name text,p_pool_id uuid,p_max_members integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb; p public.player_pools%rowtype; l uuid; begin
  existing:=beta_private.begin_command('create_beta_league',p_idempotency_key); if existing is not null then return existing; end if;
  if char_length(trim(p_name)) not between 3 and 60 or p_max_members not in (4,6,8,10) then raise exception 'Invalid league name or size'; end if;
  select * into p from public.player_pools where id=p_pool_id and is_active;
  if p.id is null then raise exception 'Player pool is not active'; end if;
  if now()>=(select min(starts_at) from public.fantasy_periods where season_id=p.season_id) then raise exception 'Season registration has closed'; end if;
  insert into public.leagues(pool_id,commissioner_id,ruleset_id,name,format,max_members,invite_code)
  values(p.id,auth.uid(),p.ruleset_id,trim(p_name),'head_to_head',p_max_members,upper(encode(extensions.gen_random_bytes(6),'hex'))) returning id into l;
  insert into public.league_members values(l,auth.uid(),'commissioner',now());
  insert into public.fantasy_teams(league_id,owner_id,name,draft_position,waiver_priority) values(l,auth.uid(),left(trim(p_name)||' Team',60),1,1);
  perform beta_private.audit('league.created','league',l::text,null,jsonb_build_object('pool_id',p.id,'size',p_max_members),p_idempotency_key);
  return beta_private.finish_command('create_beta_league',p_idempotency_key,jsonb_build_object('league_id',l,'state_version',1));
end $$;

alter function public.start_draft(uuid,integer,integer,text) rename to legacy_start_draft;
revoke all on function public.legacy_start_draft(uuid,integer,integer,text) from public,anon,authenticated,service_role;
create function public.start_draft(p_league_id uuid,p_rounds integer,p_pick_seconds integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; p public.player_pools%rowtype; existing jsonb; ordering uuid[]; d uuid; ranks jsonb; begin
  select * into l from public.leagues where id=p_league_id;
  if l.pool_id is null then return public.legacy_start_draft(p_league_id,p_rounds,p_pick_seconds,p_idempotency_key); end if;
  existing:=beta_private.begin_command('start_draft',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(l.id);
  select * into l from public.leagues where id=p_league_id for update;
  if not public.is_league_commissioner(l.id) then raise exception 'Commissioner access required'; end if;
  if l.status<>'setup' or p_rounds<>10 or p_pick_seconds<>120 then raise exception 'Draft requires ten rounds and 120 second picks'; end if;
  select * into p from public.player_pools where id=l.pool_id for share;
  if not p.is_active or p.rankings_approved_at is null then raise exception 'Approved player pool and rankings required'; end if;
  if now()>=(select min(starts_at) from public.fantasy_periods where season_id=p.season_id) then raise exception 'The season has started'; end if;
  if (select count(*) from public.fantasy_teams where league_id=l.id and owner_id is not null)<>l.max_members then raise exception 'All manager places must be filled'; end if;
  if beta_private.draft_completion(l.id) is null then raise exception 'Player pool cannot fill legal rosters for every team'; end if;
  select array_agg(id order by extensions.gen_random_bytes(16)) into ordering from public.fantasy_teams where league_id=l.id;
  update public.fantasy_teams set draft_position=null where league_id=l.id;
  update public.fantasy_teams t set draft_position=o.n,waiver_priority=l.max_members+1-o.n,preseason_order=o.n
  from unnest(ordering) with ordinality o(id,n) where t.id=o.id;
  select jsonb_agg(jsonb_build_object('athlete_id',r.athlete_id,'rank',r.rank) order by r.rank) into ranks from public.pool_rankings r where r.pool_id=p.id and r.reviewed;
  if exists(select 1 from public.athlete_seasons a join public.pool_competitions pc on pc.competition_id=a.competition_id and pc.pool_id=p.id where a.season_id=p.season_id and a.draft_eligible and not exists(select 1 from public.pool_rankings r where r.pool_id=p.id and r.athlete_id=a.athlete_id and r.reviewed)) then raise exception 'Every eligible athlete requires a reviewed rank'; end if;
  insert into public.drafts(league_id,status,rounds,pick_seconds,team_order,pick_deadline,starts_at,league_size,ranking_version,rankings_snapshot,is_test)
  values(l.id,'active',10,120,ordering,now()+interval '120 seconds',now(),l.max_members,p.rankings_version,ranks,true) returning id into d;
  update public.leagues set status='drafting',state_version=state_version+1 where id=l.id;
  perform beta_private.audit('draft.started','draft',d::text,null,jsonb_build_object('order',ordering,'ranking_version',p.rankings_version),p_idempotency_key);
  return beta_private.finish_command('start_draft',p_idempotency_key,jsonb_build_object('draft_id',d,'state_version',1));
end $$;

alter function public.make_draft_pick(uuid,uuid,text,public.draft_pick_source) rename to legacy_make_draft_pick;
revoke all on function public.legacy_make_draft_pick(uuid,uuid,text,public.draft_pick_source) from public,anon,authenticated,service_role;
create function public.make_draft_pick(p_draft_id uuid,p_athlete_id uuid,p_idempotency_key text,p_source public.draft_pick_source,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drafts%rowtype; l public.leagues%rowtype; existing jsonb; team uuid; r integer; k integer; n integer; matching jsonb; assigned jsonb; pick_id uuid; record_item record; begin
  select * into d from public.drafts where id=p_draft_id;
  select * into l from public.leagues where id=d.league_id;
  if l.pool_id is null then return public.legacy_make_draft_pick(p_draft_id,p_athlete_id,p_idempotency_key,p_source); end if;
  if p_source='autopick' then
    if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Worker access required'; end if;
  else existing:=beta_private.begin_command('make_draft_pick',p_idempotency_key); if existing is not null then return existing; end if; end if;
  perform beta_private.league_lock(l.id);
  select * into d from public.drafts where id=p_draft_id for update;
  if p_source='autopick' and exists(select 1 from public.draft_picks where draft_id=d.id and ('autopick:'||d.id||':'||overall_pick)=p_idempotency_key) then return jsonb_build_object('ignored',true); end if;
  if d.status<>'active' or d.voided_at is not null then raise exception 'Draft is not active'; end if;
  if p_expected_version is not null and d.state_version<>p_expected_version then raise exception 'Draft changed; refresh and retry' using errcode='40001'; end if;
  if (p_source='autopick' and clock_timestamp()<d.pick_deadline) or (p_source<>'autopick' and clock_timestamp()>=d.pick_deadline) then raise exception 'Pick deadline does not permit this action'; end if;
  n:=cardinality(d.team_order); r:=((d.current_overall_pick-1)/n)+1; k:=((d.current_overall_pick-1)%n)+1;
  team:=d.team_order[case when r%2=0 then n-k+1 else k end];
  if p_source='manager' and not exists(select 1 from public.fantasy_teams where id=team and owner_id=auth.uid()) then raise exception 'It is another manager''s turn'; end if;
  if p_source='commissioner' and not public.is_league_commissioner(l.id) then raise exception 'Commissioner access required'; end if;
  if not exists(select 1 from jsonb_array_elements(d.rankings_snapshot) a where a->>'athlete_id'=p_athlete_id::text) then raise exception 'Athlete is outside the draft pool'; end if;
  if exists(select 1 from public.roster_entries where league_id=l.id and athlete_id=p_athlete_id and released_at is null) then raise exception 'Athlete is already owned'; end if;
  if (select count(*) from public.roster_entries where fantasy_team_id=team and released_at is null)>=10 then raise exception 'Roster is full'; end if;
  matching:=beta_private.draft_completion(l.id,p_athlete_id,team); if matching is null then raise exception 'Pick would prevent complete legal rosters'; end if;
  assigned:=matching->'slots'->((matching->'owners'->>p_athlete_id::text)::integer);
  insert into public.draft_picks(draft_id,fantasy_team_id,athlete_id,overall_pick,round,pick_in_round,source)
  values(d.id,team,p_athlete_id,d.current_overall_pick,r,k,p_source) returning id into pick_id;
  insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
  values(l.id,team,p_athlete_id,assigned->>'code',case when assigned->>'code'='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end,'draft');
  -- Reassign flexible drafted athletes using the same completion matching.
  for record_item in select re.id,matching->'slots'->((matching->'owners'->>re.athlete_id::text)::integer) s from public.roster_entries re where re.league_id=l.id and re.released_at is null loop
    update public.roster_entries set slot_code=record_item.s->>'code',status=case when record_item.s->>'code'='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end where id=record_item.id;
  end loop;
  insert into public.roster_transactions(league_id,fantasy_team_id,transaction_type,athlete_in_id,initiated_by) values(l.id,team,'draft',p_athlete_id,auth.uid());
  delete from public.draft_queues where draft_id=d.id and athlete_id=p_athlete_id;
  update public.drafts set current_overall_pick=current_overall_pick+1,state_version=state_version+1,
    status=case when d.current_overall_pick=n*10 then 'complete'::public.draft_status else 'active'::public.draft_status end,
    completed_at=case when d.current_overall_pick=n*10 then now() end,
    pick_deadline=case when d.current_overall_pick<n*10 then clock_timestamp()+interval '120 seconds' end where id=d.id;
  update public.leagues set status=case when d.current_overall_pick=n*10 then 'active'::public.league_status else status end,state_version=state_version+1 where id=l.id;
  perform beta_private.audit('draft.pick','draft',d.id::text,null,jsonb_build_object('athlete_id',p_athlete_id,'pick',d.current_overall_pick,'source',p_source),p_idempotency_key);
  existing:=jsonb_build_object('pick_id',pick_id,'state_version',d.state_version+1);
  if p_source='autopick' then return existing; end if;
  return beta_private.finish_command('make_draft_pick',p_idempotency_key,existing);
end $$;

alter function public.set_draft_queue(uuid,uuid[],text) rename to legacy_set_draft_queue;
revoke all on function public.legacy_set_draft_queue(uuid,uuid[],text) from public,anon,authenticated,service_role;
create function public.set_draft_queue(p_draft_id uuid,p_athlete_ids uuid[],p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drafts%rowtype; team uuid; existing jsonb; begin
  select * into d from public.drafts where id=p_draft_id;
  if not exists(select 1 from public.leagues where id=d.league_id and pool_id is not null) then return public.legacy_set_draft_queue(p_draft_id,p_athlete_ids,p_idempotency_key); end if;
  existing:=beta_private.begin_command('set_draft_queue',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(d.league_id);
  select id into team from public.fantasy_teams where league_id=d.league_id and owner_id=auth.uid();
  if team is null or d.status not in ('scheduled','active','paused') then raise exception 'Active draft owner required'; end if;
  if p_athlete_ids is null or cardinality(p_athlete_ids)>500 or cardinality(p_athlete_ids)<>(select count(distinct a) from unnest(p_athlete_ids)a) then raise exception 'Invalid queue'; end if;
  if exists(select 1 from unnest(p_athlete_ids)a where not exists(select 1 from jsonb_array_elements(d.rankings_snapshot)q where q->>'athlete_id'=a::text)) then raise exception 'Ineligible athlete in queue'; end if;
  delete from public.draft_queues where draft_id=d.id and fantasy_team_id=team;
  insert into public.draft_queues(draft_id,fantasy_team_id,athlete_id,priority) select d.id,team,a,n from unnest(p_athlete_ids) with ordinality q(a,n);
  return beta_private.finish_command('set_draft_queue',p_idempotency_key,jsonb_build_object('queued',cardinality(p_athlete_ids)));
end $$;

alter function public.set_draft_status(uuid,text,text) rename to legacy_set_draft_status;
revoke all on function public.legacy_set_draft_status(uuid,text,text) from public,anon,authenticated,service_role;
create function public.set_draft_status(p_draft_id uuid,p_status public.draft_status,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drafts%rowtype; existing jsonb; begin
  select * into d from public.drafts where id=p_draft_id;
  if not exists(select 1 from public.leagues where id=d.league_id and pool_id is not null) then return public.legacy_set_draft_status(p_draft_id,p_status::text,p_idempotency_key); end if;
  existing:=beta_private.begin_command('set_draft_status',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(d.league_id); select * into d from public.drafts where id=p_draft_id for update;
  if not public.is_league_commissioner(d.league_id) then raise exception 'Commissioner access required'; end if;
  if d.status='active' and p_status='paused' then
    update public.drafts set status='paused',remaining_seconds=greatest(0,ceil(extract(epoch from pick_deadline-clock_timestamp())))::integer,pick_deadline=null,state_version=state_version+1 where id=d.id;
  elsif d.status='paused' and p_status='active' then
    update public.drafts set status='active',pick_deadline=clock_timestamp()+make_interval(secs=>coalesce(remaining_seconds,120)),remaining_seconds=null,state_version=state_version+1 where id=d.id;
  else raise exception 'Only pause and resume are allowed'; end if;
  perform beta_private.audit('draft.status','draft',d.id::text,to_jsonb(d),jsonb_build_object('status',p_status),p_idempotency_key);
  return beta_private.finish_command('set_draft_status',p_idempotency_key,jsonb_build_object('status',p_status,'state_version',d.state_version+1));
end $$;

alter function public.process_expired_drafts(integer) rename to legacy_process_expired_drafts;
revoke all on function public.legacy_process_expired_drafts(integer) from public,anon,authenticated,service_role;
create function public.process_expired_drafts(p_limit integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drafts%rowtype; a uuid; team uuid; r integer; pick_index integer; candidates uuid[]; c record; draw numeric; total integer; processed integer:=0; claims text:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}'); begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and session_user not in ('postgres','supabase_admin') then raise exception 'Worker access required'; end if;
  if p_limit not between 1 and 100 then raise exception 'Invalid limit'; end if;
  for d in select dr.* from public.drafts dr join public.leagues l on l.id=dr.league_id where l.pool_id is not null and dr.status='active' and dr.voided_at is null and dr.pick_deadline<=clock_timestamp() order by dr.pick_deadline limit p_limit loop
    perform beta_private.league_lock(d.league_id); select * into d from public.drafts where id=d.id for update;
    if d.status<>'active' or d.pick_deadline>clock_timestamp() then continue; end if;
    r:=((d.current_overall_pick-1)/cardinality(d.team_order))+1;pick_index:=((d.current_overall_pick-1)%cardinality(d.team_order))+1;
    team:=d.team_order[case when r%2=0 then cardinality(d.team_order)-pick_index+1 else pick_index end]; a:=null; candidates:='{}';
    for c in select q.athlete_id from public.draft_queues q where q.draft_id=d.id and q.fantasy_team_id=team order by q.priority loop
      if not exists(select 1 from public.roster_entries where league_id=d.league_id and athlete_id=c.athlete_id and released_at is null) and beta_private.draft_completion(d.league_id,c.athlete_id,team) is not null then a:=c.athlete_id;exit;end if;
    end loop;
    if a is null then
      for c in select (j->>'athlete_id')::uuid athlete_id from jsonb_array_elements(d.rankings_snapshot)j order by (j->>'rank')::integer loop
        if not exists(select 1 from public.roster_entries where league_id=d.league_id and athlete_id=c.athlete_id and released_at is null) and beta_private.draft_completion(d.league_id,c.athlete_id,team) is not null then candidates:=array_append(candidates,c.athlete_id); end if;
        exit when cardinality(candidates)=5;
      end loop;
      total:=0;for weighted_index in 1..cardinality(candidates) loop total:=total+6-weighted_index;end loop;
      draw:=(('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint)::numeric/4294967296*total;
      for weighted_index in 1..cardinality(candidates) loop draw:=draw-(6-weighted_index);if draw<0 then a:=candidates[weighted_index];exit;end if;end loop;
    end if;
    if a is null then update public.drafts set status='paused',pick_deadline=null,state_version=state_version+1 where id=d.id;
      perform beta_private.audit('draft.autopick_paused','draft',d.id::text,null,'{"reason":"No legal candidate"}');
    else
      -- Cron has no JWT; install the worker claim only for this transaction and restore it.
      perform set_config('request.jwt.claims',(claims::jsonb||'{"role":"service_role"}'::jsonb)::text,true);
      perform public.make_draft_pick(d.id,a,'autopick:'||d.id||':'||d.current_overall_pick,'autopick',d.state_version);processed:=processed+1;
    end if;
  end loop;
  perform set_config('request.jwt.claims',claims,true);
  return jsonb_build_object('processed',processed);
end $$;

create function public.get_athlete_adp(p_athlete_id uuid,p_pool_id uuid,p_league_size integer default null) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('average',round(avg(dp.overall_pick),2),'samples',count(*),'autopicks',count(*) filter(where dp.source='autopick'))
from public.draft_picks dp join public.drafts d on d.id=dp.draft_id join public.leagues l on l.id=d.league_id join public.player_pools p on p.id=l.pool_id
where dp.athlete_id=p_athlete_id and p.id=p_pool_id and p.is_active and d.status='complete' and not d.is_test and d.voided_at is null
and (p_league_size is null or d.league_size=p_league_size);
$$;

revoke all on function public.create_beta_league(text,uuid,integer,text),public.start_draft(uuid,integer,integer,text),public.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint),public.set_draft_queue(uuid,uuid[],text),public.set_draft_status(uuid,public.draft_status,text),public.get_athlete_adp(uuid,uuid,integer),public.process_expired_drafts(integer) from public,anon,authenticated,service_role;
grant execute on function public.create_beta_league(text,uuid,integer,text),public.start_draft(uuid,integer,integer,text),public.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint),public.set_draft_queue(uuid,uuid[],text),public.set_draft_status(uuid,public.draft_status,text),public.get_athlete_adp(uuid,uuid,integer) to authenticated;
grant execute on function public.process_expired_drafts(integer),public.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint) to service_role;
