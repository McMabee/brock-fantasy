create function beta_private.athlete_lock_at(league uuid, athlete uuid, period uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
select min(g.lineup_lock_at) from public.leagues l join public.player_pools p on p.id=l.pool_id
join public.fantasy_periods fp on fp.season_id=p.season_id and fp.id=period
join public.athlete_seasons a on a.athlete_id=athlete and a.season_id=p.season_id
join public.games g on g.competition_id=a.competition_id and a.team_id in (g.home_team_id,g.away_team_id)
where l.id=league and g.lineup_lock_at>=fp.starts_at and g.lineup_lock_at<fp.ends_at;
$$;
create function beta_private.snapshot_locks(league uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform beta_private.league_lock(league);
  insert into public.period_lineup_locks(league_id,fantasy_team_id,period_id,athlete_id,roster_entry_id,slot_code,status,locked_at)
  select league,r.fantasy_team_id,fp.id,r.athlete_id,r.id,h.slot_code,h.status,k.at
  from public.leagues l join public.player_pools p on p.id=l.pool_id join public.fantasy_periods fp on fp.season_id=p.season_id
  join public.roster_entries r on r.league_id=l.id
  cross join lateral (select beta_private.athlete_lock_at(l.id,r.athlete_id,fp.id) at)k
  cross join lateral(select sh.slot_code,sh.status from public.roster_slot_history sh where sh.roster_entry_id=r.id and sh.effective_at<=k.at order by sh.effective_at desc,sh.id desc limit 1)h
  where l.id=league and k.at<=clock_timestamp() and r.acquired_at<=k.at and (r.released_at is null or r.released_at>k.at)
  on conflict do nothing;
  insert into public.lineup_entries(league_id,fantasy_team_id,game_id,athlete_id,slot_code,locked_at)
  select x.league_id,x.fantasy_team_id,g.id,x.athlete_id,x.slot_code,x.locked_at
  from public.period_lineup_locks x join public.fantasy_periods fp on fp.id=x.period_id
  join public.athlete_seasons a on a.athlete_id=x.athlete_id and a.season_id=fp.season_id
  join public.games g on g.competition_id=a.competition_id and a.team_id in (g.home_team_id,g.away_team_id)
  where x.league_id=league and x.status='starter' and g.starts_at>=fp.starts_at and g.starts_at<fp.ends_at
  on conflict do nothing;
end $$;
create function beta_private.is_locked(league uuid,athlete uuid) returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from public.leagues l join public.player_pools p on p.id=l.pool_id join public.fantasy_periods fp on fp.season_id=p.season_id
where l.id=league and fp.starts_at<=clock_timestamp() and clock_timestamp()<fp.ends_at
and (beta_private.athlete_lock_at(league,athlete,fp.id)<=clock_timestamp() or exists(select 1 from public.period_lineup_locks x where x.league_id=league and x.athlete_id=athlete and x.period_id=fp.id)));
$$;
create function public.get_beta_lineup(p_fantasy_team_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; fp public.fantasy_periods%rowtype; begin
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=p_fantasy_team_id;
  select f.* into fp from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id where p.id=l.pool_id and f.ends_at>clock_timestamp() order by f.starts_at limit 1;
  return jsonb_build_object('period',to_jsonb(fp),'state_version',l.state_version,'entries',coalesce((
    select jsonb_agg(jsonb_build_object('id',r.id,'athlete_id',r.athlete_id,'display_name',a.display_name,'positions',s.positions,'slot_code',r.slot_code,'status',r.status,
      'locked',beta_private.is_locked(l.id,a.id),'locks_at',beta_private.athlete_lock_at(l.id,a.id,fp.id),'unlocks_at',fp.ends_at))
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id join public.player_pools p on p.id=l.pool_id join public.athlete_seasons s on s.athlete_id=a.id and s.season_id=p.season_id
    where r.fantasy_team_id=p_fantasy_team_id and r.released_at is null),'[]'));
end $$;
create function public.set_period_lineup(p_fantasy_team_id uuid,p_entries jsonb,p_expected_version bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; existing jsonb; begin
  existing:=beta_private.begin_command('set_period_lineup',p_idempotency_key); if existing is not null then return existing; end if;
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=p_fantasy_team_id;
  perform beta_private.league_lock(l.id);select * into l from public.leagues where id=l.id for update;
  if l.pool_id is null or l.status<>'active' then raise exception 'Active beta league required'; end if;
  if p_expected_version is null or l.state_version<>p_expected_version then raise exception 'Lineup changed; reload and retry' using errcode='40001'; end if;
  perform beta_private.snapshot_locks(l.id);
  if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<>(select count(*) from public.roster_entries where fantasy_team_id=p_fantasy_team_id and released_at is null)
    or jsonb_array_length(p_entries)<>(select count(distinct e->>'athlete_id') from jsonb_array_elements(p_entries)e) then raise exception 'Include each rostered athlete exactly once'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries)e(athlete_id uuid,slot_code text)
    left join public.roster_entries r on r.fantasy_team_id=p_fantasy_team_id and r.athlete_id=e.athlete_id and r.released_at is null
    left join public.player_pools p on p.id=l.pool_id left join public.athlete_seasons a on a.athlete_id=e.athlete_id and a.season_id=p.season_id
    left join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id and sr.slot_code=e.slot_code
    where r.id is null or sr.id is null or not a.positions && sr.allowed_positions or (r.slot_code<>e.slot_code and beta_private.is_locked(l.id,e.athlete_id))) then raise exception 'Invalid position or locked athlete'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries)e(athlete_id uuid,slot_code text) join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id and sr.slot_code=e.slot_code group by e.slot_code,sr.slot_count having count(*)>sr.slot_count) then raise exception 'Slot capacity exceeded'; end if;
  update public.roster_entries r set slot_code=e.slot_code,status=case when e.slot_code='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end
  from jsonb_to_recordset(p_entries)e(athlete_id uuid,slot_code text) where r.fantasy_team_id=p_fantasy_team_id and r.athlete_id=e.athlete_id and r.released_at is null;
  update public.leagues set state_version=state_version+1 where id=l.id;
  perform beta_private.audit('lineup.updated','fantasy_team',p_fantasy_team_id::text,null,p_entries,p_idempotency_key);
  return beta_private.finish_command('set_period_lineup',p_idempotency_key,jsonb_build_object('state_version',l.state_version+1));
end $$;

create function beta_private.waiver_after(league uuid,athlete uuid) returns timestamptz language sql stable security definer set search_path='' as $$
select greatest(coalesce((select max(released_at)+interval '24 hours' from public.roster_entries where league_id=league and athlete_id=athlete),'-infinity'),
coalesce((select fp.ends_at from public.leagues l join public.player_pools p on p.id=l.pool_id join public.fantasy_periods fp on fp.season_id=p.season_id
where l.id=league and fp.starts_at<=clock_timestamp() and clock_timestamp()<fp.ends_at and beta_private.athlete_lock_at(league,athlete,fp.id)<=clock_timestamp()),'-infinity'));
$$;
create function beta_private.acquire(team uuid,incoming uuid,outgoing uuid,kind public.transaction_type) returns uuid language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; slot text; tx uuid; begin
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=team;
  perform beta_private.league_lock(l.id); perform beta_private.snapshot_locks(l.id);
  if l.status<>'active' then raise exception 'League is not active'; end if;
  if not exists(select 1 from public.player_pools p join public.pool_competitions pc on pc.pool_id=p.id join public.athlete_seasons a on a.competition_id=pc.competition_id and a.season_id=p.season_id where p.id=l.pool_id and a.athlete_id=incoming and a.draft_eligible) then raise exception 'Ineligible athlete'; end if;
  if exists(select 1 from public.roster_entries where league_id=l.id and athlete_id=incoming and released_at is null) then raise exception 'Athlete is owned'; end if;
  if beta_private.waiver_after(l.id,incoming)>clock_timestamp() then raise exception 'Athlete is on waivers'; end if;
  if outgoing is not null then
    if beta_private.is_locked(l.id,outgoing) then raise exception 'Dropped athlete is locked until period end'; end if;
    update public.roster_entries set released_at=clock_timestamp() where fantasy_team_id=team and athlete_id=outgoing and released_at is null;
    if not found then raise exception 'Dropped athlete is not on this roster'; end if;
  end if;
  if (select count(*) from public.roster_entries where fantasy_team_id=team and released_at is null)>=10 then raise exception 'Roster is full'; end if;
  select sr.slot_code into slot from public.roster_slot_rules sr join public.player_pools p on p.id=l.pool_id join public.athlete_seasons a on a.season_id=p.season_id and a.athlete_id=incoming
  where sr.ruleset_id=l.ruleset_id and a.positions && sr.allowed_positions and (select count(*) from public.roster_entries r where r.fantasy_team_id=team and r.slot_code=sr.slot_code and r.released_at is null)<sr.slot_count order by sr.is_starter desc,sr.slot_code limit 1;
  if slot is null then raise exception 'Athlete cannot fit an available slot'; end if;
  insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type) values(l.id,team,incoming,slot,case when slot='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end,kind);
  insert into public.roster_transactions(league_id,fantasy_team_id,transaction_type,athlete_in_id,athlete_out_id,initiated_by) values(l.id,team,kind,incoming,outgoing,auth.uid()) returning id into tx;
  update public.leagues set state_version=state_version+1 where id=l.id;return tx;
end $$;
alter function public.add_free_agent(uuid,uuid,uuid,text) rename to legacy_add_free_agent;
revoke all on function public.legacy_add_free_agent(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.add_free_agent(p_fantasy_team_id uuid,p_athlete_in_id uuid,p_athlete_out_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb; tx uuid; begin
  if not exists(select 1 from public.fantasy_teams t join public.leagues l on l.id=t.league_id where t.id=p_fantasy_team_id and l.pool_id is not null) then return public.legacy_add_free_agent(p_fantasy_team_id,p_athlete_in_id,p_athlete_out_id,p_idempotency_key); end if;
  existing:=beta_private.begin_command('add_free_agent',p_idempotency_key);if existing is not null then return existing;end if;
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required';end if;
  tx:=beta_private.acquire(p_fantasy_team_id,p_athlete_in_id,p_athlete_out_id,'add');
  return beta_private.finish_command('add_free_agent',p_idempotency_key,jsonb_build_object('transaction_id',tx));
end $$;

-- A fixed priority per settlement batch, recalculated from finalized regular-season standings.
create function beta_private.standings(league uuid) returns table(fantasy_team_id uuid,rank bigint,wins bigint,losses bigint,ties bigint,points_for numeric,points_against numeric,standing_points numeric)
language sql stable security definer set search_path='' as $$
with results as (
 select t.id,t.preseason_order,t.draft_position,
 count(m.id) filter(where (m.home_team_id=t.id and m.home_points>m.away_points) or (m.away_team_id=t.id and m.away_points>m.home_points)) w,
 count(m.id) filter(where (m.home_team_id=t.id and m.home_points<m.away_points) or (m.away_team_id=t.id and m.away_points<m.home_points)) lost,
 count(m.id) filter(where m.home_points=m.away_points) tied,
 coalesce(sum(case when m.home_team_id=t.id then m.home_points else m.away_points end),0) pf,
 coalesce(sum(case when m.home_team_id=t.id then m.away_points else m.home_points end),0) pa
 from public.fantasy_teams t left join public.matchups m on m.league_id=t.league_id and t.id in(m.home_team_id,m.away_team_id) and m.status='final' and m.stage='regular' where t.league_id=league group by t.id
), percentages as(select *,coalesce((w+tied*0.5)/nullif(w+lost+tied,0),0) pct from results), tied_h2h as (
 select r.*,coalesce((select avg(case when m.home_points=m.away_points then 0.5 when (m.home_team_id=r.id and m.home_points>m.away_points) or (m.away_team_id=r.id and m.away_points>m.home_points) then 1 else 0 end)
 from public.matchups m join percentages other on other.id=case when m.home_team_id=r.id then m.away_team_id else m.home_team_id end and other.pct=r.pct
 where m.league_id=league and r.id in(m.home_team_id,m.away_team_id) and m.status='final' and m.stage='regular'),0) h2h from percentages r)
select id,row_number()over(order by pct desc,h2h desc,pf desc,coalesce(preseason_order,draft_position),id),w,lost,tied,pf,pa,w*2+tied from tied_h2h;
$$;
alter function public.get_league_standings(uuid) rename to legacy_get_league_standings;
revoke all on function public.legacy_get_league_standings(uuid) from public,anon,authenticated,service_role;
create function public.get_league_standings(p_league_id uuid)
returns table(fantasy_team_id uuid,rank bigint,wins bigint,losses bigint,ties bigint,points_for numeric,points_against numeric,standing_points numeric)
language plpgsql security definer set search_path='' as $$ begin
 if not public.is_league_member(p_league_id) then raise exception 'League membership required';end if;
 if exists(select 1 from public.leagues where id=p_league_id and pool_id is not null) then return query select * from beta_private.standings(p_league_id);
 else return query select s.fantasy_team_id,s.rank::bigint,s.wins::bigint,s.losses::bigint,s.ties::bigint,s.points_for::numeric,s.points_against::numeric,s.standing_points::numeric from public.legacy_get_league_standings(p_league_id)s;end if;
end $$;
alter function public.request_waiver(uuid,uuid,uuid,text) rename to legacy_request_waiver;
revoke all on function public.legacy_request_waiver(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.request_waiver(p_fantasy_team_id uuid,p_athlete_in_id uuid,p_athlete_out_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb;l uuid;claim uuid;due timestamptz;begin
  select t.league_id into l from public.fantasy_teams t join public.leagues ll on ll.id=t.league_id and ll.pool_id is not null where t.id=p_fantasy_team_id;
  if l is null then return public.legacy_request_waiver(p_fantasy_team_id,p_athlete_in_id,p_athlete_out_id,p_idempotency_key);end if;
  existing:=beta_private.begin_command('request_waiver',p_idempotency_key);if existing is not null then return existing;end if;
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required';end if;
  perform beta_private.league_lock(l);due:=beta_private.waiver_after(l,p_athlete_in_id);
  if due<=clock_timestamp() then raise exception 'Athlete is available for immediate acquisition';end if;
  if exists(select 1 from public.roster_entries where league_id=l and athlete_id=p_athlete_in_id and released_at is null) then raise exception 'Athlete is owned';end if;
  if exists(select 1 from public.waiver_claims where fantasy_team_id=p_fantasy_team_id and athlete_in_id=p_athlete_in_id and status='pending') then raise exception 'Claim already pending';end if;
  insert into public.waiver_claims(league_id,fantasy_team_id,athlete_in_id,athlete_out_id,priority_at_claim,process_after) values(l,p_fantasy_team_id,p_athlete_in_id,p_athlete_out_id,1,due) returning id into claim;
  return beta_private.finish_command('request_waiver',p_idempotency_key,jsonb_build_object('claim_id',claim,'process_after',due));
end $$;
alter function public.process_due_waivers(uuid) rename to legacy_process_due_waivers;
revoke all on function public.legacy_process_due_waivers(uuid) from public,anon,authenticated,service_role;
create function public.process_due_waivers(p_league_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;tx uuid;begin
  perform beta_private.league_lock(p_league_id);
  if not exists(select 1 from public.leagues where id=p_league_id and pool_id is not null) then return public.legacy_process_due_waivers(p_league_id);end if;
  for c in select w.* from public.waiver_claims w join beta_private.standings(p_league_id)s on s.fantasy_team_id=w.fantasy_team_id
  where w.league_id=p_league_id and w.status='pending' and w.process_after<=clock_timestamp() order by s.rank desc,w.created_at,w.id limit 500 loop
    begin
      tx:=beta_private.acquire(c.fantasy_team_id,c.athlete_in_id,c.athlete_out_id,'waiver');
      update public.waiver_claims set status='successful',processed_at=now() where id=c.id;n:=n+1;
      perform beta_private.audit('waiver.settled','waiver',c.id::text,null,jsonb_build_object('transaction_id',tx));
    exception when others then
      update public.waiver_claims set status='failed',processed_at=now() where id=c.id;
      perform beta_private.audit('waiver.failed','waiver',c.id::text,null,jsonb_build_object('reason',sqlerrm));
    end;
  end loop;return jsonb_build_object('successful',n);
end $$;

alter function public.generate_matchup_schedule(uuid,timestamptz,integer,text) rename to legacy_generate_matchup_schedule;
revoke all on function public.legacy_generate_matchup_schedule(uuid,timestamptz,integer,text) from public,anon,authenticated,service_role;
create function public.generate_matchup_schedule(p_league_id uuid,p_starts_at timestamptz,p_cycles integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb;l public.leagues%rowtype;teams uuid[];fp public.fantasy_periods%rowtype;n integer;tail uuid;begin
  select * into l from public.leagues where id=p_league_id;
  if l.pool_id is null then return public.legacy_generate_matchup_schedule(p_league_id,p_starts_at,p_cycles,p_idempotency_key);end if;
  existing:=beta_private.begin_command('generate_matchup_schedule',p_idempotency_key);if existing is not null then return existing;end if;
  perform beta_private.league_lock(l.id);
  if not public.is_league_commissioner(l.id) or l.status not in ('drafting','active') then raise exception 'Commissioner of a started league required';end if;
  if exists(select 1 from public.matchups where league_id=l.id) then raise exception 'Schedule already generated';end if;
  select array_agg(id order by preseason_order) into teams from public.fantasy_teams where league_id=l.id;n:=cardinality(teams);
  for fp in select f.* from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id where p.id=l.pool_id and f.phase='regular' order by number loop
    for i in 1..n/2 loop
      insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id)
      values(l.id,fp.number,fp.starts_at,fp.ends_at,case when fp.number%2=1 then teams[i] else teams[n-i+1] end,case when fp.number%2=1 then teams[n-i+1] else teams[i] end);
    end loop;
    tail:=teams[n];teams:=array[teams[1],tail]||teams[2:n-1];
  end loop;
  update public.leagues set state_version=state_version+1 where id=l.id;
  return beta_private.finish_command('generate_matchup_schedule',p_idempotency_key,jsonb_build_object('periods',8,'matchups_created',n*4));
end $$;

revoke all on function public.get_beta_lineup(uuid),public.set_period_lineup(uuid,jsonb,bigint,text),public.add_free_agent(uuid,uuid,uuid,text),public.request_waiver(uuid,uuid,uuid,text),public.get_league_standings(uuid),public.generate_matchup_schedule(uuid,timestamptz,integer,text),public.process_due_waivers(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_beta_lineup(uuid),public.set_period_lineup(uuid,jsonb,bigint,text),public.add_free_agent(uuid,uuid,uuid,text),public.request_waiver(uuid,uuid,uuid,text),public.get_league_standings(uuid),public.generate_matchup_schedule(uuid,timestamptz,integer,text) to authenticated;
grant execute on function public.process_due_waivers(uuid) to service_role;
