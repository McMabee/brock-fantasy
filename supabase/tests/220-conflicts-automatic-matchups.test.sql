begin;
select no_plan();
create function pg_temp.a_id(text) returns uuid language sql immutable as $$ select md5('automatic-schedules:'||$1)::uuid; $$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.a_id('user'||n),'backlog-'||n||'@example.test',now(),now(),jsonb_build_object('display_name','Backlog test '||n,'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1') from generate_series(1,10)n;
insert into auth.sessions(id,user_id,aal) select pg_temp.a_id('user'||n),pg_temp.a_id('user'||n),'aal1' from generate_series(1,10)n;
insert into public.sports(code,name) values('hockey','Hockey') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.a_id('competition'),id,'mens','Backlog hockey','backlog-fixture','b0000000-0000-4000-8000-000000000004',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name,is_brock) values(pg_temp.a_id('program'),pg_temp.a_id('competition'),'Backlog Brock','BRO',true);
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
select pg_temp.a_id('athlete'||n),pg_temp.a_id('competition'),pg_temp.a_id('program'),'Backlog athlete '||n,'F','{}' from generate_series(1,4)n;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select pg_temp.a_id('athlete'||n),'b0000000-0000-4000-8000-000000000002',pg_temp.a_id('competition'),pg_temp.a_id('program'),array['F'],true,true from generate_series(1,4)n;
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
values(pg_temp.a_id('league'),'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004',pg_temp.a_id('user1'),'Backlog league','AUTO220',4,'head_to_head','active');
insert into public.league_members(league_id,user_id,role) select pg_temp.a_id('league'),pg_temp.a_id('user'||n),(case when n=1 then 'commissioner' else 'member' end)::public.league_member_role from generate_series(1,4)n;
insert into public.fantasy_teams(id,league_id,owner_id,name) select pg_temp.a_id('team'||n),pg_temp.a_id('league'),pg_temp.a_id('user'||n),'Backlog team '||n from generate_series(1,4)n;
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
select pg_temp.a_id('league'),pg_temp.a_id('team'||n),pg_temp.a_id('athlete'||n),'HK_F','starter','draft' from generate_series(1,4)n;

update public.fantasy_periods set starts_at=now()+make_interval(days=>number*7),ends_at=now()+make_interval(days=>number*7+6) where season_id='b0000000-0000-4000-8000-000000000002';
update public.fantasy_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '5 days' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;

select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','rpc_private','beta_private','registration_private') and p.prosrc~'40001'),0,'application routines never raise retryable serialization codes for business conflicts');
select ok(not has_function_privilege('authenticated','beta_private.ensure_matchup_schedule(uuid)','execute'),'clients cannot execute the scheduling helper');
select ok(not has_function_privilege('anon','beta_private.matchup_plan(uuid)','execute'),'anonymous callers cannot inspect private schedule plans');
insert into public.pool_competitions(pool_id,competition_id) values('b0000000-0000-4000-8000-000000000003',pg_temp.a_id('competition'));
insert into public.teams(id,competition_id,name,short_name) values(pg_temp.a_id('away'),pg_temp.a_id('competition'),'Away','AWY');
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status,schedule_kind)
values(pg_temp.a_id('game'),pg_temp.a_id('competition'),pg_temp.a_id('program'),pg_temp.a_id('away'),now()+interval '1 hour','scheduled','regular');
insert into public.drafts(league_id,status,rounds,pick_seconds,team_order,completed_at) select pg_temp.a_id('league'),'complete',10,120,array_agg(pg_temp.a_id('team'||n) order by n),now() from generate_series(1,4)n;
select is(jsonb_array_length(beta_private.matchup_plan(pg_temp.a_id('league'))->'periods'),8,'draft completed before first scoring game includes underway period');
create temp table saved_plan as select beta_private.matchup_plan(pg_temp.a_id('league')) data;
select lives_ok($$select beta_private.ensure_matchup_schedule(pg_temp.a_id('league'))$$,'missing schedule is generated');
select is((select count(*)::integer from public.matchups where league_id=pg_temp.a_id('league')),16,'four teams receive all eight regular periods');
select is((select count(*)::integer from public.matchups where league_id=pg_temp.a_id('league') and period=1 and status='active'),2,'underway pairings are activated immediately');
select ok(not exists(select 1 from public.matchups m join public.fantasy_periods f on f.number=m.period where m.league_id=pg_temp.a_id('league') and f.phase<>'regular'),'playoffs are never generated');
create temp table saved_matchups as select * from public.matchups where league_id=pg_temp.a_id('league');
select is((beta_private.ensure_matchup_schedule(pg_temp.a_id('league'))->>'matchups_created')::integer,0,'repeat generation adds no rows');
select ok(not exists((select * from saved_matchups except select * from public.matchups)),'repeat generation preserves IDs opponents and scores');
delete from public.matchups where league_id=pg_temp.a_id('league') and period=1;
insert into public.fantasy_point_events(league_id,fantasy_team_id,athlete_id,game_id,ruleset_id,stat_key,stat_value,points,kind,source_identity)
values(pg_temp.a_id('league'),pg_temp.a_id('team1'),pg_temp.a_id('athlete1'),pg_temp.a_id('game'),'b0000000-0000-4000-8000-000000000004','fixture',1,12.5,'score','automatic-repair-fixture');
select is((beta_private.ensure_matchup_schedule(pg_temp.a_id('league'))->>'matchups_created')::integer,2,'repair fills only missing week one pairings');
select is((select sum(home_points+away_points) from public.matchups where league_id=pg_temp.a_id('league')),12.5::numeric,'repair initializes totals from the existing ledger');
select is((select count(*)::integer from public.fantasy_point_events where source_identity='automatic-repair-fixture'),1,'repair does not replay or duplicate earned points');
select ok(not exists((select * from saved_matchups where period<>1 except select * from public.matchups)),'repair preserves all previously scheduled periods');
update public.matchups set starts_at=starts_at+interval '1 second' where league_id=pg_temp.a_id('league') and period=2;
select throws_ok($$select beta_private.ensure_matchup_schedule(pg_temp.a_id('league'))$$,'PT409','Existing matchup schedule differs from canonical pairings','repair rejects mismatched existing schedules');
update public.matchups m set starts_at=s.starts_at from saved_matchups s where m.id=s.id;
select is(beta_private.league_entry_period('b0000000-0000-4000-8000-000000000003',4,(select lineup_lock_at from public.games where id=pg_temp.a_id('game'))),
  (select id from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002'and number=2),'completion exactly at the first lock excludes that period');
select is(beta_private.league_entry_period('b0000000-0000-4000-8000-000000000003',4,now()+interval '2 hours'),
  (select id from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002'and number=2),'completion after the first game starts at the next full period');
update public.games set status='cancelled' where id=pg_temp.a_id('game');
select is(beta_private.league_entry_period('b0000000-0000-4000-8000-000000000003',4,now()),
  (select id from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002'and number=2),'unknown scoring fixtures conservatively use period start');
update public.games set status='scheduled' where id=pg_temp.a_id('game');
update public.drafts set completed_at=now() where league_id=pg_temp.a_id('league');
select set_config('request.jwt.claim.sub',pg_temp.a_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.a_id('user1'),'session_id',pg_temp.a_id('user1'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select lives_ok($$select public.confirm_matchup_schedule(pg_temp.a_id('league'),'old-client-preview','automatic-compat')$$,'older clients return the existing schedule without a confirmation gate');
select throws_ok($$select public.set_period_lineup(pg_temp.a_id('team1'),'[]',-1,'automatic-stale-lineup')$$,'PT409','Lineup changed; reload and retry','stale lineups return a nonretryable conflict');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.a_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.a_id('user2'),'session_id',pg_temp.a_id('user2'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select throws_ok($$select public.get_matchup_preview(pg_temp.a_id('league'))$$,'42501','Commissioner access required','compatibility preview retains commissioner enforcement');
select throws_ok($$select public.set_period_lineup(pg_temp.a_id('team1'),'[]',-1,'automatic-foreign-lineup')$$,'P0001','Team owner access required','conflict change never bypasses ownership');
reset role;

-- - Compare the set-based planner against an independent circle-rotation reference
create temp table expected_pairs(size integer,period integer,home_team_id uuid,away_team_id uuid);
do $$
declare size integer; league uuid; ordered uuid[]; tail uuid; period integer;
begin
  foreach size in array array[4,6,8,10] loop
    league:=pg_temp.a_id('size-league'||size);
    insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
    values(league,'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004',pg_temp.a_id('user1'),'Size fixture','SIZE220-'||size,size,'head_to_head','active');
    insert into public.league_members(league_id,user_id,role) select league,pg_temp.a_id('user'||n),(case when n=1 then 'commissioner' else 'member' end)::public.league_member_role from generate_series(1,size)n;
    insert into public.fantasy_teams(id,league_id,owner_id,name) select pg_temp.a_id('size-team'||size||'-'||n),league,pg_temp.a_id('user'||n),'Size team '||n from generate_series(1,size)n;
    select array_agg(id order by preseason_order nulls last,id) into ordered from public.fantasy_teams where league_id=league;
    insert into public.drafts(league_id,status,rounds,pick_seconds,team_order,completed_at)values(league,'complete',10,120,ordered,now());
    for period in 1..case when size=8 then 7 else 8 end loop
      for i in 1..size/2 loop
        insert into expected_pairs values(size,period,case when period%2=1 then ordered[i] else ordered[size-i+1] end,case when period%2=1 then ordered[size-i+1] else ordered[i] end);
      end loop;
      tail:=ordered[size];ordered:=array[ordered[1],tail]||ordered[2:size-1];
    end loop;
  end loop;
end;$$;
select is(jsonb_array_length(beta_private.matchup_plan(pg_temp.a_id('size-league'||n))->'pairings'),n*(case when n=8 then 7 else 8 end)/2,'approved pairing count for '||n||' teams')from unnest(array[4,6,8,10])n;
select ok(not exists(
  (select e.size,e.period,e.home_team_id,e.away_team_id from expected_pairs e except
   select n,p.period,p.home_team_id,p.away_team_id from unnest(array[4,6,8,10])n cross join lateral jsonb_to_recordset(beta_private.matchup_plan(pg_temp.a_id('size-league'||n))->'pairings')p(period integer,home_team_id uuid,away_team_id uuid))
),'set-based generation preserves every canonical opponent and home orientation');


-- - Exercise the actual final-pick path with legal completion matching for all caller modes
insert into public.athletes(id,competition_id,team_id,display_name,position)
select pg_temp.a_id('draft-athlete'||n),pg_temp.a_id('competition'),pg_temp.a_id('program'),'Completion athlete '||n,'F' from generate_series(1,100)n;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select pg_temp.a_id('draft-athlete'||n),'b0000000-0000-4000-8000-000000000002',pg_temp.a_id('competition'),pg_temp.a_id('program'),array['F','D','G','BC','FC','HT','L','S'],true,true from generate_series(1,100)n;
do $$
declare size integer; league uuid; draft uuid; ordered uuid[]; owner uuid; source text; idx integer; team uuid; round integer; pick integer;
begin
  foreach size in array array[4,6,8] loop
    source:=case size when 4 then 'manager' when 6 then 'commissioner' else 'autopick' end;
    league:=pg_temp.a_id('size-league'||size);
    select array_agg(id order by preseason_order nulls last,id)into ordered from public.fantasy_teams where league_id=league;
    select id into draft from public.drafts where league_id=league and voided_at is null;
    update public.leagues set status='drafting' where id=league;
    update public.drafts set status='active',completed_at=null,current_overall_pick=size*10,pick_deadline=case when source='autopick' then now()-interval '1 second' else now()+interval '1 hour' end,
      rankings_snapshot=(select jsonb_agg(jsonb_build_object('athlete_id',pg_temp.a_id('draft-athlete'||n),'rank',n)order by n)from generate_series(1,100)n) where id=draft;
    for idx in 1..size*10-1 loop
      round:=(idx-1)/size+1;pick:=(idx-1)%size+1;team:=ordered[case when round%2=1 then pick else size-pick+1 end];
      insert into public.draft_picks(draft_id,fantasy_team_id,athlete_id,overall_pick,round,pick_in_round,source)values(draft,team,pg_temp.a_id('draft-athlete'||idx),idx,round,pick,'manager');
      insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)values(league,team,pg_temp.a_id('draft-athlete'||idx),'BN','bench','draft');
    end loop;
    if source='autopick' then
      perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
      perform public.process_expired_drafts(1);
    else
      if source='commissioner' then owner:=pg_temp.a_id('user1');else select owner_id into owner from public.fantasy_teams where id=ordered[1];end if;
      perform set_config('request.jwt.claim.sub',owner::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'session_id',owner,'role','authenticated','aal','aal1')::text,true);
      perform public.make_draft_pick(draft,pg_temp.a_id('draft-athlete'||(size*10)),'complete-'||source||'-220',source::public.draft_pick_source,1);
    end if;
  end loop;
end;$$;
select is((select status::text from public.drafts where league_id=pg_temp.a_id('size-league'||n)and voided_at is null),'complete','final pick completes '||n||'-team draft')from unnest(array[4,6,8])n;
select is((select count(*)::integer from public.matchups where league_id=pg_temp.a_id('size-league'||n)),n*(case when n=8 then 7 else 8 end)/2,'final pick automatically schedules '||n||'-team league')from unnest(array[4,6,8])n;

select * from finish();
rollback;
