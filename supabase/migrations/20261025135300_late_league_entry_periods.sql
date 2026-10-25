set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Persist the scoring-period decision made when a draft completes
alter table public.leagues add column first_scoring_period_id uuid references public.fantasy_periods(id);
create index leagues_first_scoring_period on public.leagues(first_scoring_period_id) where first_scoring_period_id is not null;
create index matchups_league_interval on public.matchups(league_id,starts_at,ends_at);

-- - Resolve each period cutoff from the first eligible scoring fixture
create function beta_private.period_scoring_lock(p_pool_id uuid,p_period_id uuid)
returns timestamptz language sql stable strict security invoker set search_path='' as $$
select coalesce((
  select min(g.lineup_lock_at) from public.pool_competitions pc join public.games g on g.competition_id=pc.competition_id
  where pc.pool_id=p_pool_id and g.starts_at>=f.starts_at and g.starts_at<f.ends_at
    and g.status not in('cancelled','postponed') and g.schedule_kind in('regular','playoff')
),f.starts_at)
from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
where p.id=p_pool_id and f.id=p_period_id and f.phase='regular';
$$;
revoke all on function beta_private.period_scoring_lock(uuid,uuid) from public,anon,authenticated,service_role;

-- - Select the first playable approved period without using mutable clock state
create function beta_private.league_entry_period(p_pool_id uuid,p_managers integer,p_completed_at timestamptz)
returns uuid language sql stable strict security invoker set search_path='' as $$
select periods.id from (
  select f.id,f.number,beta_private.period_scoring_lock(p_pool_id,f.id) scoring_lock
  from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
  where p.id=p_pool_id and f.phase='regular' and p_managers in(4,6,8,10)
  order by f.number limit case when p_managers=8 then 7 else 8 end
)periods where p_completed_at<periods.scoring_lock
  and p_completed_at<coalesce((select min(f.starts_at) from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id where p.id=p_pool_id and f.phase<>'regular'),'infinity'::timestamptz)
order by periods.number limit 1;
$$;
revoke all on function beta_private.league_entry_period(uuid,integer,timestamptz) from public,anon,authenticated,service_role;

-- - Expose the final permitted creation and draft deadline for each league size
create function beta_private.draft_window_deadline(p_pool_id uuid,p_managers integer)
returns timestamptz language sql stable strict security invoker set search_path='' as $$
select case when max(periods.scoring_lock) is not null then least(max(periods.scoring_lock),(select min(f.starts_at) from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id where p.id=p_pool_id and f.phase<>'regular')) end from (
  select beta_private.period_scoring_lock(p_pool_id,f.id) scoring_lock
  from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
  where p.id=p_pool_id and f.phase='regular' and p_managers in(4,6,8,10)
  order by f.number limit case when p_managers=8 then 7 else 8 end
)periods;
$$;
revoke all on function beta_private.draft_window_deadline(uuid,integer) from public,anon,authenticated,service_role;

-- - Keep league creation and draft-start windows on one calendar predicate
create or replace function beta_private.has_draft_window(p_pool_id uuid,p_managers integer,p_at timestamptz)
returns boolean language sql stable strict security invoker set search_path='' as $$
select coalesce(p_at<beta_private.draft_window_deadline(p_pool_id,p_managers),false)
  and exists(select 1 from public.player_pools p join public.fantasy_seasons s on s.id=p.season_id where p.id=p_pool_id and s.status<>'complete');
$$;
revoke all on function beta_private.has_draft_window(uuid,integer,timestamptz) from public,anon,authenticated,service_role;

-- - Select one approved pool from the newest published season by calendar order
create function beta_private.current_league_pool()
returns table(pool_id uuid,season_id uuid,season_label text,season_starts_at timestamptz)
language sql stable security invoker set search_path='' as $$
with published as (
  select p.id pool_id,p.season_id,s.label season_label,min(f.starts_at) season_starts_at
  from public.player_pools p join public.fantasy_seasons s on s.id=p.season_id
  join public.fantasy_periods f on f.season_id=s.id and f.phase='regular'
  where p.is_active and p.rankings_approved_at is not null
  group by p.id,p.season_id,s.label
), selected_season as (
  select season_id from published order by season_starts_at desc,season_id desc limit 1
)
select p.pool_id,p.season_id,p.season_label,p.season_starts_at from published p join selected_season s using(season_id)
where (select count(*) from published same_season where same_season.season_id=p.season_id)=1;
$$;
revoke all on function beta_private.current_league_pool() from public,anon,authenticated,service_role;

-- - Return server-selected season and deadline details through the authenticated read boundary
create function rpc_private.get_league_creation_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare selected record; windows jsonb;
begin
  perform rpc_private.require_app_access();
  select * into selected from beta_private.current_league_pool();
  if selected.pool_id is null then
    return jsonb_build_object('available',false,'reason','No published season is available for new leagues');
  end if;
  select jsonb_object_agg(size::text,jsonb_build_object(
    'open',beta_private.has_draft_window(selected.pool_id,size,clock_timestamp()),
    'deadline',beta_private.draft_window_deadline(selected.pool_id,size),
    'firstScoringPeriodId',beta_private.league_entry_period(selected.pool_id,size,clock_timestamp())
  )order by size) into windows from unnest(array[4,6,8,10])size;
  return jsonb_build_object('available',true,'poolId',selected.pool_id,'seasonId',selected.season_id,
    'seasonLabel',selected.season_label,'seasonStartsAt',selected.season_starts_at,'windows',windows);
end;
$$;
create function public.get_league_creation_context() returns jsonb
language sql stable security invoker set search_path='' as $$
select rpc_private.get_league_creation_context();
$$;
revoke all on function rpc_private.get_league_creation_context(),public.get_league_creation_context() from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_league_creation_context(),public.get_league_creation_context() to authenticated;

-- - Reject stale pools and admit new leagues while a usable regular period remains
create or replace function rpc_private.create_beta_league(
  p_name text,p_pool_id uuid,p_max_members integer,p_idempotency_key text,p_team_name text
)returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb;pool public.player_pools%rowtype;v_league_id uuid;
begin
  perform rpc_private.require_app_access();
  existing:=beta_private.begin_command('create_beta_league',p_idempotency_key);if existing is not null then return existing;end if;
  if p_name is null or char_length(btrim(p_name))not between 3 and 60 or p_max_members is null or p_max_members not in(4,6,8,10)then raise exception 'Invalid league name or size'using errcode='22023';end if;
  if p_team_name is null or char_length(btrim(p_team_name))not between 3 and 60 then raise exception 'Team name must be 3 to 60 characters'using errcode='22023';end if;
  select p.* into pool from public.player_pools p join beta_private.current_league_pool()selected on selected.pool_id=p.id;
  if pool.id is null then raise exception 'No published season is available for new leagues'using errcode='22023';end if;
  if p_pool_id is distinct from pool.id then raise exception 'Season details changed. Refresh and try again.'using errcode='PT409';end if;
  if not beta_private.has_draft_window(pool.id,p_max_members,clock_timestamp())then raise exception 'No eligible regular-season periods remain for a new league'using errcode='22023';end if;
  insert into public.leagues(pool_id,commissioner_id,ruleset_id,name,format,max_members,invite_code)
  values(pool.id,auth.uid(),pool.ruleset_id,btrim(p_name),'head_to_head',p_max_members,upper(encode(extensions.gen_random_bytes(6),'hex')))returning id into v_league_id;
  insert into public.league_members(league_id,user_id,role)values(v_league_id,auth.uid(),'commissioner');
  insert into public.fantasy_teams(league_id,owner_id,name,draft_position,waiver_priority)values(v_league_id,auth.uid(),btrim(p_team_name),1,1);
  perform beta_private.audit('league.created','league',v_league_id::text,null,jsonb_build_object('pool_id',pool.id,'size',p_max_members,'team_name',btrim(p_team_name)),p_idempotency_key);
  return beta_private.finish_command('create_beta_league',p_idempotency_key,jsonb_build_object('league_id',v_league_id,'state_version',1));
end;
$$;

-- - Freeze entry when the draft reaches completion for every supported draft mode
create function beta_private.capture_league_entry_period() returns trigger
language plpgsql security definer set search_path='' as $$
declare league public.leagues%rowtype;entry_period uuid;completed_at timestamptz;
begin
  if new.status<>'complete' or new.voided_at is not null then return new;end if;
  if tg_op='UPDATE' and old.status='complete' then return new;end if;
  perform beta_private.league_lock(new.league_id);
  select * into league from public.leagues where id=new.league_id for update;
  if league.pool_id is null then return new;end if;
  completed_at:=coalesce(new.completed_at,clock_timestamp());
  entry_period:=beta_private.league_entry_period(league.pool_id,league.max_members,completed_at);
  update public.leagues set first_scoring_period_id=entry_period,state_version=state_version+1 where id=league.id;
  perform beta_private.audit(case when entry_period is null then 'league.entry_window_missed' else 'league.entry_period_set' end,
    'league',league.id::text,null,jsonb_build_object('draft_id',new.id,'first_scoring_period_id',entry_period,'completed_at',completed_at));
  return new;
end;
$$;
revoke all on function beta_private.capture_league_entry_period() from public,anon,authenticated,service_role;
create trigger capture_league_entry_period after insert or update of status on public.drafts for each row execute function beta_private.capture_league_entry_period();

-- - Preserve the published schedule when available and derive older unscheduled leagues once
update public.leagues l set first_scoring_period_id=source.id
from(
  select distinct on(live.id)live.id league_id,f.id
  from public.leagues live join public.matchups m on m.league_id=live.id
  join public.player_pools p on p.id=live.pool_id
  join public.fantasy_periods f on f.season_id=p.season_id and f.number=m.period
  where live.pool_id is not null
  order by live.id,f.number,m.starts_at
)source where source.league_id=l.id and l.first_scoring_period_id is null;
update public.leagues l set first_scoring_period_id=beta_private.league_entry_period(l.pool_id,l.max_members,coalesce(d.completed_at,(select max(p.created_at)from public.draft_picks p where p.draft_id=d.id),d.created_at))
from public.drafts d where d.league_id=l.id and d.status='complete'and d.voided_at is null
  and l.pool_id is not null and l.first_scoring_period_id is null;

-- - Use the frozen entry period while preserving established circle rotation
create or replace function beta_private.matchup_plan(p_league_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.leagues%rowtype;d public.drafts%rowtype;teams uuid[];n integer;completed timestamptz;entry_period uuid;payload jsonb;
begin
  select * into l from public.leagues where id=p_league_id;
  if l.id is null or l.pool_id is null or l.format<>'head_to_head'then raise exception 'Combined head-to-head league required';end if;
  select * into d from public.drafts where league_id=l.id and voided_at is null and status='complete';
  if d.id is null then raise exception 'Complete the draft before setting up matchups';end if;
  completed:=coalesce(d.completed_at,(select max(created_at)from public.draft_picks where draft_id=d.id),d.created_at);
  select array_agg(id order by preseason_order nulls last,id)into teams from public.fantasy_teams where league_id=l.id;n:=cardinality(teams);
  if n is null or n not in(4,6,8,10)or n<>l.max_members then raise exception 'All league seats must be filled';end if;
  entry_period:=l.first_scoring_period_id;
  with approved as(
    select f.*,row_number()over(order by f.number)::integer-1 rotation from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
    where p.id=l.pool_id and f.phase='regular'order by f.number limit case when n=8 then 7 else 8 end
  ),eligible as(
    select f.*from approved f where entry_period is not null and f.number>=(select number from public.fantasy_periods where id=entry_period)
  ),positions as(
    select f.*,i,teams[case when i=1 then 1 else 2+mod(mod(i-2-f.rotation,n-1)+n-1,n-1)end]first_team,
      teams[2+mod(mod(n-i-1-f.rotation,n-1)+n-1,n-1)]second_team from eligible f cross join generate_series(1,n/2)i
  )select jsonb_build_object('league_id',l.id,'state_version',l.state_version,'draft_id',d.id,'completed_at',completed,
    'first_scoring_period_id',entry_period,'periods',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',number,'starts_at',starts_at,'ends_at',ends_at)order by number)from eligible),'[]'),
    'pairings',coalesce((select jsonb_agg(jsonb_build_object('period',number,'starts_at',starts_at,'ends_at',ends_at,'home_team_id',case when number%2=1 then first_team else second_team end,'away_team_id',case when number%2=1 then second_team else first_team end)order by number,i)from positions),'[]'),
    'shortened',(select count(*)from eligible)<(select count(*)from approved),'can_generate',exists(select 1 from eligible),'already_generated',exists(select 1 from public.matchups where league_id=l.id))into payload;
  return payload||jsonb_build_object('signature',md5(payload::text));
end;
$$;
revoke all on function beta_private.matchup_plan(uuid) from public,anon,authenticated,service_role;

-- - Snapshot only games that belong to a published league matchup
create or replace function beta_private.snapshot_locks(league uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform beta_private.league_lock(league);
  insert into public.game_lineup_snapshots
  select l.id,r.fantasy_team_id,g.id,r.athlete_id,r.id,fp.id,h.slot_code,h.status,g.lineup_lock_at
  from public.leagues l join public.player_pools p on p.id=l.pool_id
  join public.fantasy_periods fp on fp.season_id=p.season_id
  join public.games g on g.starts_at>=fp.starts_at and g.starts_at<fp.ends_at and g.lineup_lock_at<=clock_timestamp()
    and g.status not in('postponed','cancelled')and g.schedule_kind in('regular','playoff')
  join public.athlete_seasons a on a.season_id=p.season_id and a.competition_id=g.competition_id and a.team_id in(g.home_team_id,g.away_team_id)
  join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.acquired_at<=g.lineup_lock_at and(released_at is null or r.released_at>g.lineup_lock_at)
  cross join lateral(select sh.slot_code,sh.status from public.roster_slot_history sh where sh.roster_entry_id=r.id and sh.effective_at<=g.lineup_lock_at order by sh.effective_at desc,sh.id desc limit 1)h
  where l.id=league and exists(select 1 from public.matchups m where m.league_id=l.id and g.starts_at>=m.starts_at and g.starts_at<m.ends_at)
    and beta_private.can_field_athlete(r.fantasy_team_id,r.athlete_id,g.lineup_lock_at)
    and not exists(select 1 from public.game_lineup_snapshots x where x.league_id=l.id and x.game_id=g.id and x.athlete_id=r.athlete_id)
  on conflict do nothing;
  insert into public.lineup_entries(league_id,fantasy_team_id,game_id,athlete_id,slot_code,locked_at)
  select x.league_id,x.fantasy_team_id,x.game_id,x.athlete_id,x.slot_code,x.locked_at from public.game_lineup_snapshots x
  where x.league_id=league and x.status='starter' on conflict do nothing;
end;
$$;

-- - Score snapshots only when their game belongs to a league matchup
do $replay$
declare definition text;anchor text:='where pll.status = ''starter''';
begin
  select pg_get_functiondef('beta_private.replay_beta_game(uuid,text)'::regprocedure)into definition;
  if position(anchor in definition)=0 then raise exception 'Expected scoring snapshot guard';end if;
  definition:=replace(definition,anchor,anchor||' and exists(select 1 from public.matchups matchup where matchup.league_id=pll.league_id and game.starts_at>=matchup.starts_at and game.starts_at<matchup.ends_at)');
  execute definition;
end;
$replay$;

notify pgrst,'reload schema';
