set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Derive each circle-method pairing once and retain calendar rotation across skipped periods
-- - Use the completed draft and first scoring lock instead of the time an operator opens settings
create function beta_private.matchup_plan(p_league_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.leagues%rowtype; d public.drafts%rowtype; teams uuid[]; n integer; completed timestamptz; payload jsonb;
begin
  select * into l from public.leagues where id=p_league_id;
  if l.id is null or l.pool_id is null or l.format<>'head_to_head' then raise exception 'Combined head-to-head league required'; end if;
  select * into d from public.drafts where league_id=l.id and voided_at is null and status='complete';
  if d.id is null then raise exception 'Complete the draft before setting up matchups'; end if;
  completed:=coalesce(d.completed_at,(select max(created_at) from public.draft_picks where draft_id=d.id),d.created_at);
  select array_agg(id order by preseason_order nulls last,id) into teams from public.fantasy_teams where league_id=l.id;
  n:=cardinality(teams);
  if n is null or n not in(4,6,8,10) or n<>l.max_members then raise exception 'All league seats must be filled'; end if;
  with approved as (
    select f.*,row_number() over(order by f.number)::integer-1 rotation
    from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
    where p.id=l.pool_id and f.phase='regular' order by f.number limit case when n=8 then 7 else 8 end
  ), eligible as (
    select f.* from approved f where completed<coalesce((
      select min(g.lineup_lock_at) from public.pool_competitions pc join public.games g on g.competition_id=pc.competition_id
      where pc.pool_id=l.pool_id and g.starts_at>=f.starts_at and g.starts_at<f.ends_at
        and g.status not in('cancelled','postponed') and g.schedule_kind in('regular','playoff')
    ),f.starts_at)
  ), positions as (
    select f.*,i,
      teams[case when i=1 then 1 else 2+mod(mod(i-2-f.rotation,n-1)+n-1,n-1) end] first_team,
      teams[2+mod(mod(n-i-1-f.rotation,n-1)+n-1,n-1)] second_team
    from eligible f cross join generate_series(1,n/2)i
  )
  select jsonb_build_object('league_id',l.id,'state_version',l.state_version,'draft_id',d.id,'completed_at',completed,
    'periods',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',number,'starts_at',starts_at,'ends_at',ends_at) order by number) from eligible),'[]'),
    'pairings',coalesce((select jsonb_agg(jsonb_build_object('period',number,'starts_at',starts_at,'ends_at',ends_at,
      'home_team_id',case when number%2=1 then first_team else second_team end,
      'away_team_id',case when number%2=1 then second_team else first_team end) order by number,i) from positions),'[]'),
    'shortened',(select count(*) from eligible)<(select count(*) from approved),
    'can_generate',exists(select 1 from eligible),
    'already_generated',exists(select 1 from public.matchups where league_id=l.id)) into payload;
  return payload||jsonb_build_object('signature',md5(payload::text));
end;
$$;
revoke all on function beta_private.matchup_plan(uuid) from public,anon,authenticated,service_role;

-- - Fill missing canonical pairings without changing previously published opponents or scores
-- - Aggregate existing point events without replaying or rewriting the scoring ledger
create function beta_private.ensure_matchup_schedule(p_league_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare plan jsonb; added integer; result jsonb;
begin
  perform beta_private.league_lock(p_league_id);
  perform 1 from public.leagues where id=p_league_id for update;
  plan:=beta_private.matchup_plan(p_league_id);
  if exists(
    select 1 from public.matchups m where m.league_id=p_league_id and not exists(
      select 1 from jsonb_to_recordset(plan->'pairings')p(period integer,starts_at timestamptz,ends_at timestamptz,home_team_id uuid,away_team_id uuid)
      where (p.period,p.starts_at,p.ends_at,p.home_team_id,p.away_team_id)=(m.period,m.starts_at,m.ends_at,m.home_team_id,m.away_team_id)
    )
  ) then raise exception 'Existing matchup schedule differs from canonical pairings' using errcode='PT409'; end if;
  with pairs as (
    select * from jsonb_to_recordset(plan->'pairings')p(period integer,starts_at timestamptz,ends_at timestamptz,home_team_id uuid,away_team_id uuid)
  ), totals as (
    select e.fantasy_team_id,p.number,sum(e.points) points from public.fantasy_point_events e
    join public.games g on g.id=e.game_id
    join jsonb_to_recordset(plan->'periods')p(number integer,starts_at timestamptz,ends_at timestamptz)
      on g.starts_at>=p.starts_at and g.starts_at<p.ends_at
    where e.league_id=p_league_id group by e.fantasy_team_id,p.number
  )
  insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id,home_points,away_points,status)
  select p_league_id,p.period,p.starts_at,p.ends_at,p.home_team_id,p.away_team_id,coalesce(h.points,0),coalesce(a.points,0),
    case when p.starts_at<=clock_timestamp() then 'active'::public.matchup_status else 'scheduled'::public.matchup_status end
  from pairs p left join totals h on h.number=p.period and h.fantasy_team_id=p.home_team_id
  left join totals a on a.number=p.period and a.fantasy_team_id=p.away_team_id
  where not exists(select 1 from public.matchups m where m.league_id=p_league_id and m.period=p.period and m.home_team_id=p.home_team_id);
  get diagnostics added=row_count;
  if added>0 then
    update public.leagues set state_version=state_version+1 where id=p_league_id;
    perform beta_private.audit('matchups.generated','league',p_league_id::text,null,
      jsonb_build_object('draft_id',plan->'draft_id','automatic',true,'matchups_created',added,'plan',plan),
      'automatic-matchups:'||(plan->>'draft_id')||':'||added);
  end if;
  result:=jsonb_build_object('periods',jsonb_array_length(plan->'periods'),'matchups_created',added,'already_generated',added=0);
  return result;
end;
$$;
revoke all on function beta_private.ensure_matchup_schedule(uuid) from public,anon,authenticated,service_role;

create or replace function rpc_private.get_matchup_preview(p_league_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  if not public.is_league_commissioner(p_league_id) then raise exception 'Commissioner access required' using errcode='42501'; end if;
  return beta_private.matchup_plan(p_league_id);
end;
$$;

create or replace function rpc_private.confirm_matchup_schedule(p_league_id uuid,p_expected_signature text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb; preview jsonb; result jsonb;
begin
  perform rpc_private.require_app_access();
  existing:=beta_private.begin_command('confirm_matchup_schedule',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(p_league_id);
  preview:=rpc_private.get_matchup_preview(p_league_id);
  if (preview->>'already_generated')::boolean then
    result:=jsonb_build_object('periods',(select count(distinct period) from public.matchups where league_id=p_league_id),'matchups_created',0,'already_generated',true);
  else
    if p_expected_signature is null or preview->>'signature'<>p_expected_signature then raise exception 'Schedule preview changed; reload and review again' using errcode='PT409'; end if;
    if (preview->>'can_generate')::boolean is not true then raise exception 'No eligible fantasy periods remain'; end if;
    result:=beta_private.ensure_matchup_schedule(p_league_id);
  end if;
  return beta_private.finish_command('confirm_matchup_schedule',p_idempotency_key,result);
end;
$$;

-- - Add automatic generation to the shared manual and worker completion path after league activation
do $migration$
declare definition text; anchor text:='perform beta_private.audit(''draft.pick''';
begin
  select pg_get_functiondef('rpc_private.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint)'::regprocedure) into definition;
  if position(anchor in definition)=0 then raise exception 'Canonical draft completion path changed'; end if;
  execute replace(definition,anchor,
    'if d.current_overall_pick=n*10 and l.format=''head_to_head'' then perform beta_private.ensure_matchup_schedule(l.id); end if; '||anchor);
end;
$migration$;

notify pgrst,'reload schema';
