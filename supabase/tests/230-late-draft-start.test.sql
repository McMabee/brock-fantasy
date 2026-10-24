begin;
select no_plan();
-- - Keep draft fixtures independent of the published season start date
update public.fantasy_periods set starts_at=now()+make_interval(days=>number*7),ends_at=now()+make_interval(days=>number*7+6);
create function pg_temp.v_id(text) returns uuid language sql immutable as $$ select md5('varsity-fixture:'||$1)::uuid; $$;

insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.v_id('user'||n),'varsity-'||n||'@example.test',now(),now(),jsonb_build_object('display_name','Participant '||n,
  'varsity_role',case when n=1 then 'athlete' else 'none' end,'varsity_programs',case when n=1 then '["womens_volleyball"]'::jsonb else '[]'::jsonb end,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from generate_series(1,9)n;
insert into auth.sessions(id,user_id,aal) select pg_temp.v_id('user'||n),pg_temp.v_id('user'||n),(case when n=9 then 'aal2' else 'aal1' end)::auth.aal_level from generate_series(1,9)n;
insert into public.user_roles(user_id,role) values(pg_temp.v_id('user9'),'admin');
insert into public.sports(code,name) values('hockey','Hockey'),('basketball','Basketball'),('volleyball','Volleyball') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.v_id(program),s.id,division::public.division_code,program,'varsity-fixture','b0000000-0000-4000-8000-000000000004',true
from (values('mens_hockey','hockey','mens'),('womens_hockey','hockey','womens'),('mens_basketball','basketball','mens'),('womens_basketball','basketball','womens'),('mens_volleyball','volleyball','mens'),('womens_volleyball','volleyball','womens'))p(program,sport,division)
join public.sports s on s.code::text=p.sport;
insert into public.teams(id,competition_id,name,short_name,is_brock)
select pg_temp.v_id(c.name||'-team'),c.id,'Brock '||c.name,'BRO',true from public.competitions c where season_label='varsity-fixture';
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
select pg_temp.v_id(c.name||n),c.id,t.id,c.name||' athlete '||n,
  case when c.name like '%hockey' then (array['F','D','G'])[1+(n%3)] when c.name like '%basketball' then (array['BC','FC'])[1+(n%2)] else (array['HT','L','S'])[1+(n%3)] end,
  jsonb_build_object('program',c.name)
from public.competitions c join public.teams t on t.competition_id=c.id cross join generate_series(1,24)n where c.season_label='varsity-fixture';
insert into public.player_pools(id,season_id,ruleset_id,name,is_active,rankings_approved_at)
values(pg_temp.v_id('pool'),'b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004','Varsity test pool',true,now());
insert into public.pool_competitions(pool_id,competition_id) select pg_temp.v_id('pool'),id from public.competitions where season_label='varsity-fixture';
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select a.id,'b0000000-0000-4000-8000-000000000002',a.competition_id,a.team_id,array[a.position],true,true from public.athletes a join public.competitions c on c.id=a.competition_id where c.season_label='varsity-fixture';
insert into public.pool_rankings(pool_id,athlete_id,rank) select pg_temp.v_id('pool'),a.id,row_number() over(order by a.id) from public.athletes a join public.competitions c on c.id=a.competition_id where c.season_label='varsity-fixture';
update public.pool_rankings set reviewed=true,basis='Reviewed isolated varsity fixture' where pool_id=pg_temp.v_id('pool');
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,format,max_members,invite_code)
values(pg_temp.v_id('league'),pg_temp.v_id('pool'),'b0000000-0000-4000-8000-000000000004',pg_temp.v_id('user1'),'Varsity test','head_to_head',8,'VARSTEST');
insert into public.league_members(league_id,user_id,role) select pg_temp.v_id('league'),pg_temp.v_id('user'||n),case when n=1 then 'commissioner'::public.league_member_role else 'member'::public.league_member_role end from generate_series(1,8)n;
insert into public.fantasy_teams(id,league_id,owner_id,name,draft_position,preseason_order,waiver_priority) select pg_temp.v_id('team'||n),pg_temp.v_id('league'),pg_temp.v_id('user'||n),'Team '||n,n,n,n from generate_series(1,8)n;

update public.fantasy_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '5 days' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;

select ok(not has_function_privilege('anon','beta_private.has_draft_window(uuid,integer,timestamptz)','execute'),'anonymous callers cannot execute the private calendar helper');
select ok(not has_function_privilege('authenticated','beta_private.has_draft_window(uuid,integer,timestamptz)','execute'),'authenticated callers cannot execute the private calendar helper');
select ok(not has_function_privilege('service_role','beta_private.has_draft_window(uuid,integer,timestamptz)','execute'),'service clients cannot execute the private calendar helper');
select ok(beta_private.has_draft_window(pg_temp.v_id('pool'),8,clock_timestamp()),'underway season permits a draft when future regular periods remain');
select ok(beta_private.has_draft_window(pg_temp.v_id('pool'),8,(select starts_at-interval '1 microsecond' from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002' and number=7)),'eight-manager window includes the instant before the seventh cutoff');
select ok(not beta_private.has_draft_window(pg_temp.v_id('pool'),8,(select starts_at from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002' and number=7)),'eight managers cannot use the eighth period when seven cutoffs passed');
select ok(beta_private.has_draft_window(pg_temp.v_id('pool'),4,(select starts_at from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002' and number=7)),'four managers retain the eighth approved regular period');
select ok(not beta_private.has_draft_window(pg_temp.v_id('pool'),4,(select starts_at from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002' and number=8)),'unknown fixtures use the period start as the strict cutoff');
select ok(not beta_private.has_draft_window(pg_temp.v_id('pool'),5,clock_timestamp()),'unsupported league sizes have no draft window');

insert into public.teams(id,competition_id,name,short_name) values(pg_temp.v_id('late-opponent'),pg_temp.v_id('mens_hockey'),'Late opponent','OPP');
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,lineup_lock_at,status)
select pg_temp.v_id('late-game'),pg_temp.v_id('mens_hockey'),pg_temp.v_id('mens_hockey-team'),pg_temp.v_id('late-opponent'),starts_at+interval '2 hours',starts_at+interval '2 hours','scheduled'
from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002' and number=7;
select ok(beta_private.has_draft_window(pg_temp.v_id('pool'),8,(select lineup_lock_at-interval '1 microsecond' from public.games where id=pg_temp.v_id('late-game'))),'known scoring fixtures extend the cutoff beyond midnight');
select ok(not beta_private.has_draft_window(pg_temp.v_id('pool'),8,(select lineup_lock_at from public.games where id=pg_temp.v_id('late-game'))),'the exact first scoring lock closes the last draft window');
update public.games set status='cancelled' where id=pg_temp.v_id('late-game');
select ok(not beta_private.has_draft_window(pg_temp.v_id('pool'),8,(select starts_at-interval '1 minute' from public.games where id=pg_temp.v_id('late-game'))),'cancelled fixtures cannot extend the draft window');
delete from public.games where id=pg_temp.v_id('late-game');
update public.fantasy_periods set phase='semifinal' where season_id='b0000000-0000-4000-8000-000000000002' and number=8;
select ok(not beta_private.has_draft_window(pg_temp.v_id('pool'),4,(select starts_at from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002' and number=7)),'playoff periods cannot admit a late draft');
update public.fantasy_periods set phase='regular' where season_id='b0000000-0000-4000-8000-000000000002' and number=8;

select set_config('request.jwt.claim.sub',pg_temp.v_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user2'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user2'))::text,true);
set local role authenticated;
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'late-outsider-start')$$,'P0001','Commissioner access required','a member cannot start the draft');
select throws_ok($$select public.schedule_league_draft(pg_temp.v_id('league'),now()+interval '1 hour',0,'late-outsider-schedule')$$,'42501','Commissioner access required','a member cannot schedule the draft');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
select throws_ok($$select public.schedule_league_draft(pg_temp.v_id('league'),now()+interval '1 hour',-1,'late-stale')$$,'PT409','League changed; refresh and retry','stale scheduling keeps its nonretryable conflict code');
select throws_ok($$select public.schedule_league_draft(pg_temp.v_id('league'),now()-interval '1 minute',(select state_version from public.leagues where id=pg_temp.v_id('league')),'late-past')$$,'22023','Choose a future date while an eligible regular-season period remains','past planned dates remain invalid');
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),9,120,'late-rounds')$$,'P0001','Draft requires ten rounds and the saved pick duration','late draft cannot change the required rounds');
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,60,'late-duration')$$,'P0001','Draft requires ten rounds and the saved pick duration','late draft cannot bypass the saved pick duration');
reset role;
update public.player_pools set rankings_approved_at=null where id=pg_temp.v_id('pool');
set local role authenticated;
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'late-unapproved')$$,'P0001','Approved player pool and rankings required','late draft still requires approved rankings');
reset role;
update public.player_pools set rankings_approved_at=now() where id=pg_temp.v_id('pool');
update public.fantasy_teams set owner_id=null where id=pg_temp.v_id('team8');
set local role authenticated;
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'late-empty-seat')$$,'P0001','All manager places must be filled','late draft still requires every manager seat');
reset role;
update public.fantasy_teams set owner_id=pg_temp.v_id('user8') where id=pg_temp.v_id('team8');
update public.fantasy_periods set starts_at=now()-make_interval(days=>100-number*7),ends_at=now()-make_interval(days=>99-number*7) where season_id='b0000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'late-no-periods')$$,'22023','No eligible regular-season periods remain for a new draft','a finished regular season cannot admit a new draft');
select throws_ok($$select public.schedule_league_draft(pg_temp.v_id('league'),now()+interval '1 hour',(select state_version from public.leagues where id=pg_temp.v_id('league')),'late-no-schedule')$$,'22023','Choose a future date while an eligible regular-season period remains','a finished regular season cannot accept a scheduled draft');
reset role;
update public.fantasy_periods set starts_at=now()+make_interval(days=>number*7),ends_at=now()+make_interval(days=>number*7+6) where season_id='b0000000-0000-4000-8000-000000000002';
update public.fantasy_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '5 days' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;
set local role authenticated;
select lives_ok($$select public.schedule_league_draft(pg_temp.v_id('league'),now()+interval '1 hour',(select state_version from public.leagues where id=pg_temp.v_id('league')),'late-schedule')$$,'commissioner can schedule a draft after the season starts');
select lives_ok($$select public.schedule_league_draft(pg_temp.v_id('league'),now()+interval '1 hour',-1,'late-schedule')$$,'schedule receipt remains idempotent');
select lives_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'late-start')$$,'commissioner can start a legal draft after the season starts');
select lives_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'late-start')$$,'start receipt remains idempotent');
select is((select count(*)::integer from public.drafts where league_id=pg_temp.v_id('league')),1,'start retries create one draft');
select is((select status::text from public.leagues where id=pg_temp.v_id('league')),'drafting','starting the draft keeps the league in drafting status');
select is((select count(*)::integer from public.matchups where league_id=pg_temp.v_id('league')),0,'no matchups exist before the late draft finishes');
reset role;
select * from finish();
rollback;
