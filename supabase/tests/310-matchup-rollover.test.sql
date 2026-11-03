begin;
select no_plan();
create function pg_temp.r_id(text) returns uuid language sql immutable as $$select md5('matchup-rollover:'||$1)::uuid;$$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
values(pg_temp.r_id('user'),'rollover@example.test',now(),now(),jsonb_build_object('display_name','Rollover fixture','varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'));
insert into public.sports(code,name) values('hockey','Hockey') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.r_id('competition'||n),s.id,'mens','Rollover competition '||n,'rollover-fixture-'||n,'b0000000-0000-4000-8000-000000000004',true
from public.sports s cross join generate_series(1,3)n where s.code='hockey';
insert into public.player_pools(id,season_id,ruleset_id,name,is_active)
values(pg_temp.r_id('pool'),'b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004','Rollover pool',true);
insert into public.pool_competitions(pool_id,competition_id) select pg_temp.r_id('pool'),pg_temp.r_id('competition'||n) from generate_series(1,2)n;
insert into public.leagues(id,pool_id,competition_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
select pg_temp.r_id(kind),case when kind='pool-league' then pg_temp.r_id('pool') end,case when kind='legacy-league' then pg_temp.r_id('competition1') end,
'b0000000-0000-4000-8000-000000000004',pg_temp.r_id('user'),kind,kind,4,'head_to_head','active' from unnest(array['pool-league','legacy-league'])kind;
insert into public.fantasy_teams(id,league_id,owner_id,name)
select pg_temp.r_id(kind||n),pg_temp.r_id(kind),case when n=1 then pg_temp.r_id('user') end,'Rollover team '||n
from unnest(array['pool-league','legacy-league'])kind cross join generate_series(1,2)n;

-- - Anchor all relative fixtures to the transaction's fixed now including exact boundaries
insert into public.matchups(id,league_id,period,starts_at,ends_at,home_team_id,away_team_id,status,home_points,away_points,finalized_at)
select pg_temp.r_id('matchup'||period),pg_temp.r_id('pool-league'),period,now()+make_interval(days=>starts),now()+make_interval(days=>ends),
pg_temp.r_id('pool-league1'),pg_temp.r_id('pool-league2'),status::public.matchup_status,12.5,8.25,case when status='final' then now()-interval '40 days' end
from (values
(1,-30,-29,'active'),(2,-28,-27,'scheduled'),(3,-26,-25,'final'),
(4,-6,-5,'active'),(5,-4,-3,'active'),(6,-8,-7,'scheduled'),(7,-10,-9,'active'),
(8,-1,0,'active'),(9,0,1,'scheduled'),(10,1,2,'scheduled'),(11,0,1,'final'),(12,-24,-23,'scheduled')
)fixture(period,starts,ends,status);
insert into public.matchups(id,league_id,period,starts_at,ends_at,home_team_id,away_team_id,status)
values(pg_temp.r_id('legacy'),pg_temp.r_id('legacy-league'),1,now()-interval '6 days',now()-interval '5 days',pg_temp.r_id('legacy-league1'),pg_temp.r_id('legacy-league2'),'active');
insert into public.teams(id,competition_id,name,short_name)
select pg_temp.r_id('program'||c||'-'||n),pg_temp.r_id('competition'||c),'Rollover program '||c||n,'R'||c||n from generate_series(1,3)c cross join generate_series(1,2)n;
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status,stats_complete,schedule_kind)
select pg_temp.r_id(label),pg_temp.r_id('competition'||competition),pg_temp.r_id('program'||competition||'-1'),pg_temp.r_id('program'||competition||'-2'),now()+make_interval(days=>starts),status::public.game_status,complete,kind
from (values
('pending',2,-6,'scheduled',false,'regular'),
('incomplete',1,-4,'final',false,'regular'),
('cancelled',1,-8,'cancelled',false,'regular'),
('postponed',2,-8,'postponed',false,'regular'),
('exhibition',1,-10,'scheduled',false,'exhibition'),
('other-competition',3,-30,'scheduled',false,'regular'),
('at-end-boundary',1,0,'scheduled',false,'regular'),
('legacy-pending',1,-6,'in_progress',false,'regular')
)fixture(label,competition,starts,status,complete,kind);
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status,stats_complete)
values(pg_temp.r_id('historical-game'),pg_temp.r_id('competition1'),pg_temp.r_id('program1-1'),pg_temp.r_id('program1-2'),now()-interval '26 days','final',true);
insert into public.athletes(id,competition_id,team_id,display_name,position)
values(pg_temp.r_id('athlete'),pg_temp.r_id('competition1'),pg_temp.r_id('program1-1'),'Rollover athlete','F');
insert into public.fantasy_point_events(league_id,fantasy_team_id,athlete_id,game_id,ruleset_id,stat_key,stat_value,points,kind,source_identity)
values(pg_temp.r_id('pool-league'),pg_temp.r_id('pool-league1'),pg_temp.r_id('athlete'),pg_temp.r_id('historical-game'),'b0000000-0000-4000-8000-000000000004','fixture',1,12.5,'score','rollover-historical-score');
create temp table saved_matchups as select * from public.matchups where league_id in(pg_temp.r_id('pool-league'),pg_temp.r_id('legacy-league'));
create temp table saved_events as select * from public.fantasy_point_events;
create temp table saved_standings as select * from beta_private.standings(pg_temp.r_id('pool-league'));

select ok(not has_function_privilege('anon','public.advance_matchup_periods(integer)','execute'),'anonymous callers cannot advance periods');
select ok(not has_function_privilege('authenticated','public.advance_matchup_periods(integer)','execute'),'application users cannot advance periods');
select ok(has_function_privilege('service_role','public.advance_matchup_periods(integer)','execute'),'trusted workers retain access');
select throws_ok($$select public.advance_matchup_periods(null)$$,'P0001','Invalid processing limit','null cannot turn the bounded worker into an unlimited scan');
select throws_ok($$select public.advance_matchup_periods(0)$$,'P0001','Invalid processing limit','zero batch rejected');

select lives_ok($$select public.advance_matchup_periods(1)$$,'bounded worker catches up without requiring an app visit');
select lives_ok($$select public.advance_matchup_periods(1000)$$,'next batch recovers all missed periods');
select is((select status::text from public.matchups where id=pg_temp.r_id('matchup'||n)),'final','expired period '||n||' is finalized')from unnest(array[1,2,6,7,8,12])n;
select is((select status::text from public.matchups where id=pg_temp.r_id('matchup9')),'active','new period activates at its inclusive start');
select is((select status::text from public.matchups where id=pg_temp.r_id('matchup10')),'scheduled','future period stays scheduled');
select is((select status::text from public.matchups where id=pg_temp.r_id('matchup4')),'active','unfinished games in either pool competition block finalization');
select is((select status::text from public.matchups where id=pg_temp.r_id('matchup5')),'active','final game with incomplete stat publication blocks finalization');
select is((select status::text from public.matchups where id=pg_temp.r_id('legacy')),'active','legacy unfinished game safeguard is retained');
select ok(not exists(select 1 from saved_matchups s join public.matchups m using(id) where s.status='final' and to_jsonb(s)<>to_jsonb(m)),'finalized historical and current records are never reopened or rewritten');
select ok(not exists(select 1 from saved_matchups s join public.matchups m using(id) where s.home_points<>m.home_points or s.away_points<>m.away_points or s.starts_at<>m.starts_at or s.ends_at<>m.ends_at),'rollover preserves scores and calendar boundaries');
select ok(not exists((select * from saved_events except select * from public.fantasy_point_events)union all(select * from public.fantasy_point_events except select * from saved_events)),'scoring ledger is unchanged');
select is((select wins from beta_private.standings(pg_temp.r_id('pool-league')) where fantasy_team_id=pg_temp.r_id('pool-league1')),
  (select wins+6 from saved_standings where fantasy_team_id=pg_temp.r_id('pool-league1')),'standings include the six newly finalized wins');
create temp table after_rollover as select * from public.matchups;
create temp table after_notifications as select * from public.notifications;
select is(public.advance_matchup_periods(1000),' {"activated":0,"finalized":0}'::jsonb,'repeat tick performs no transitions');
select ok(not exists((select * from after_rollover except select * from public.matchups)union all(select * from public.matchups except select * from after_rollover)),'repeat tick leaves every matchup unchanged');
select is((select count(*) from public.notifications),(select count(*) from after_notifications),'repeat tick does not duplicate result notifications');

-- - Administrative completion is separate from calendar advancement and recovers on a later tick
update public.games set status='final',stats_complete=true where id in(pg_temp.r_id('pending'),pg_temp.r_id('incomplete'),pg_temp.r_id('legacy-pending'));
select lives_ok($$select public.advance_matchup_periods(1000)$$,'completion permits previously blocked results on the next tick');
select is((select status::text from public.matchups where id=pg_temp.r_id('matchup'||n)),'final','administratively complete period '||n||' finalizes')from unnest(array[4,5])n;
select is((select status::text from public.matchups where id=pg_temp.r_id('legacy')),'final','completed legacy matchup finalizes');

select is('2026-11-01 00:00 America/Toronto'::timestamptz,'2026-11-01 04:00+00'::timestamptz,'Toronto midnight before fall transition uses daylight offset');
select is('2026-11-14 00:00 America/Toronto'::timestamptz,'2026-11-14 05:00+00'::timestamptz,'Toronto midnight after fall transition uses standard offset');
select is((select count(*)::integer from cron.job where jobname='brock-matchup-rollover'),1,'exactly one named rollover job exists');
select is((select schedule from cron.job where jobname='brock-matchup-rollover'),'* * * * *','rollover runs every minute');
select is((select command from cron.job where jobname='brock-matchup-rollover'),'select public.advance_matchup_periods(1000);','job uses the bounded database worker');
select cron.schedule('brock-matchup-rollover','* * * * *','select public.advance_matchup_periods(1000);');
select is((select count(*)::integer from cron.job where jobname='brock-matchup-rollover'),1,'repeated named registration does not duplicate the schedule');
select * from finish();
rollback;
