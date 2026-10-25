begin;
select no_plan();
-- - Keep draft fixtures independent of the published season start date
update public.fantasy_periods set starts_at=now()+make_interval(days=>number*7),ends_at=now()+make_interval(days=>number*7+6);
create function pg_temp.v_id(text) returns uuid language sql immutable as $$ select md5('varsity-fixture:'||$1)::uuid; $$;

-- - Exercise fresh signup validation without granting privileges from editable metadata
select throws_ok($$insert into auth.users(id,email,created_at,raw_user_meta_data) values(pg_temp.v_id('missing-role'),'missing-role@example.test',now(),jsonb_build_object('display_name','Valid Name','beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'))$$,'22023','Varsity participation selection is required','direct signup cannot omit the explicit participation choice');
select throws_ok($$insert into auth.users(id,email,created_at,raw_user_meta_data) values(pg_temp.v_id('missing-name'),'missing-name@example.test',now(),jsonb_build_object('display_name','  ','varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'))$$,'22023','Full name is required','direct signup requires a nonblank name');
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.v_id('user'||n),'varsity-'||n||'@example.test',now(),now(),jsonb_build_object('display_name','Participant '||n,
  'varsity_role',case when n=1 then 'athlete' else 'none' end,'varsity_programs',case when n=1 then '["womens_volleyball"]'::jsonb else '[]'::jsonb end,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from generate_series(1,9)n;
insert into auth.sessions(id,user_id,aal) select pg_temp.v_id('user'||n),pg_temp.v_id('user'||n),(case when n=9 then 'aal2' else 'aal1' end)::auth.aal_level from generate_series(1,9)n;
insert into public.user_roles(user_id,role) values(pg_temp.v_id('user9'),'admin');
select is((select is_varsity from public.profiles where id=pg_temp.v_id('user1')),true,'signup records the varsity badge');
select is((select count(*)::int from public.user_roles where user_id=pg_temp.v_id('user1')),0,'varsity signup grants no staff role');
update auth.users set raw_user_meta_data=raw_user_meta_data||'{"varsity_role":"none","varsity_programs":[]}' where id=pg_temp.v_id('user1');
select is((select role from beta_private.account_participation where user_id=pg_temp.v_id('user1')),'athlete','editable Auth metadata cannot clear participation');

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
select is((select roster_format from public.leagues where id=pg_temp.v_id('league')),'varsity','one varsity athlete changes the entire league format');
select is((select sum(slot_count)::int from public.roster_slot_rules r join public.leagues l on l.ruleset_id=r.ruleset_id where l.id=pg_temp.v_id('league') and r.is_starter),7,'varsity format has seven starters including FLEX');
select is((select slot_count from public.roster_slot_rules r join public.leagues l on l.ruleset_id=r.ruleset_id where l.id=pg_temp.v_id('league') and r.slot_code='BN'),3,'varsity format has three shared bench spots');
select ok((select bool_and(allowed_positions=array['F','D','G']) from public.roster_slot_rules r join public.leagues l on l.ruleset_id=r.ruleset_id where l.id=pg_temp.v_id('league') and r.slot_code in ('HK_F','HK_DG')),'both hockey slots allow every hockey position');
select ok(beta_private.draft_completion(pg_temp.v_id('league')) is not null,'eight managers can complete legal rosters with affiliations');
select ok(beta_private.draft_completion(pg_temp.v_id('league'),pg_temp.v_id('womens_volleyball1'),pg_temp.v_id('team1')) is null,'a teammate pick is excluded from draft matching');
select ok(beta_private.draft_completion(pg_temp.v_id('league'),pg_temp.v_id('mens_volleyball1'),pg_temp.v_id('team1')) is not null,'same sport from another program remains legal');

select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
select throws_ok($$update public.profiles set is_varsity=false where id=pg_temp.v_id('user1')$$,'42501',null,'participants cannot edit their badge');
select throws_ok($$select public.admin_find_participants('Participant')$$,'42501','Administrator MFA required','participants cannot search private account records');
select throws_ok($$select public.admin_set_participation(pg_temp.v_id('user1'),'none','{}',1,'Unauthorized edit','varsity-unauthorized')$$,'42501','Administrator MFA required','participants cannot clear affiliations');
select throws_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),19,(select state_version from public.leagues where id=pg_temp.v_id('league')),'timer-under-min')$$,'22023','Pick duration must be between 20 and 86400 seconds','server rejects a pick timer below twenty seconds');
select throws_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),null,(select state_version from public.leagues where id=pg_temp.v_id('league')),'timer-null')$$,'22023','Pick duration must be between 20 and 86400 seconds','server rejects an omitted pick timer');
select throws_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),86401,(select state_version from public.leagues where id=pg_temp.v_id('league')),'timer-over-max')$$,'22023','Pick duration must be between 20 and 86400 seconds','server retains the existing twenty-four-hour timer limit');
select set_config('request.jwt.claim.sub',pg_temp.v_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user2'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user2'))::text,true);
select throws_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),30,(select state_version from public.leagues where id=pg_temp.v_id('league')),'timer-member')$$,'42501','Commissioner access required','ordinary members cannot change the pick timer');
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
select lives_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),20,(select state_version from public.leagues where id=pg_temp.v_id('league')),'timer-save')$$,'commissioner can save the twenty-second minimum at AAL1');
select is((select draft_pick_seconds from public.leagues where id=pg_temp.v_id('league')),20,'league saves its own pick timer');
select lives_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),20,0,'timer-save')$$,'save retry returns the existing receipt despite its old version');
select throws_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),40,0,'timer-stale')$$,'PT409','League changed; refresh and retry','a stale commissioner cannot overwrite a saved timer');
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'varsity-wrong-timer')$$,'P0001','Draft requires ten rounds and the saved pick duration','draft creation cannot bypass the saved timer');
select lives_ok($$select public.start_draft(pg_temp.v_id('league'),10,20,'varsity-start')$$,'varsity league starts a legal ten-round draft with its saved timer');
select is((select pick_seconds from public.drafts where league_id=pg_temp.v_id('league')),20,'active draft snapshots the saved duration');
select is((select extract(epoch from pick_deadline-starts_at)::integer from public.drafts where league_id=pg_temp.v_id('league')),20,'first autodraft deadline uses the saved duration');
select throws_ok($$select public.set_league_pick_duration(pg_temp.v_id('league'),40,(select state_version from public.leagues where id=pg_temp.v_id('league')),'timer-after-start')$$,'22023','Pick duration can only change before the draft starts','active draft timer cannot be changed');
reset role;
update public.drafts set team_order=(select array_agg(pg_temp.v_id('team'||n) order by n) from generate_series(1,8)n) where league_id=pg_temp.v_id('league');
set local role authenticated;
select throws_ok($$select public.make_draft_pick((select id from public.drafts where league_id=pg_temp.v_id('league')),pg_temp.v_id('womens_volleyball1'),'varsity-banned-pick','manager',1)$$,'P0001','Pick would prevent complete legal rosters','manual picks reject teammates');
select lives_ok($$select public.set_draft_queue((select id from public.drafts where league_id=pg_temp.v_id('league')),array[pg_temp.v_id('womens_volleyball1'),pg_temp.v_id('mens_volleyball1')],'varsity-queue')$$,'queued choices remain ordered');
select ok((select (c->'blockedTeamIds') ? pg_temp.v_id('team1')::text from jsonb_array_elements(public.get_draft_room_snapshot((select id from public.drafts where league_id=pg_temp.v_id('league')))->'candidates')c where c->>'id'=pg_temp.v_id('womens_volleyball1')::text),'draft snapshot sends manager-specific exclusions for client matching');
reset role;
update public.drafts set pick_deadline=clock_timestamp()-interval '1 second' where league_id=pg_temp.v_id('league');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.process_expired_drafts(1)$$,'autopick processes the restricted manager queue');
reset role;
select is((select athlete_id from public.draft_picks where fantasy_team_id=pg_temp.v_id('team1')),pg_temp.v_id('mens_volleyball1'),'autopick skips the teammate and uses the next legal queued athlete');

update public.leagues set status='active' where id=pg_temp.v_id('league');
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
select pg_temp.v_id('league'),pg_temp.v_id('team2'),pg_temp.v_id(program||n),slot,case when slot='BN' then 'bench'::public.roster_status else 'starter'::public.roster_status end,'draft'
from (values('mens_hockey',1,'HK_F'),('mens_hockey',2,'HK_DG'),('mens_basketball',1,'BB_BC'),('mens_basketball',2,'BB_FC'),('womens_volleyball',1,'VB_HT'),('womens_volleyball',2,'VB_LS'),('mens_hockey',3,'FLEX'),('mens_hockey',4,'BN'),('mens_basketball',3,'BN'),('mens_volleyball',2,'BN')) r(program,n,slot);
select set_config('request.jwt.claim.sub',pg_temp.v_id('user9')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user9'),'role','authenticated','aal','aal2','session_id',pg_temp.v_id('user9'))::text,true);
set local role authenticated;
select lives_ok($$select public.admin_set_participation(pg_temp.v_id('user2'),'coach',array['womens_volleyball'],1,'Confirmed varsity coach','varsity-coach-update')$$,'MFA administrator can identify a coach and programs');
select lives_ok($$select public.admin_set_participation(pg_temp.v_id('user2'),'coach',array['womens_volleyball'],1,'Confirmed varsity coach','varsity-coach-update')$$,'administrator correction retries are idempotent');
select throws_ok($$select public.admin_set_participation(pg_temp.v_id('user2'),'none','{}',1,'Stale status correction','varsity-stale-update')$$,'PT409','Participation changed; reload and retry','stale corrections cannot overwrite a newer status');
select is(jsonb_array_length(public.admin_find_participants('Participant')),9,'administrators can find existing accounts by name');
reset role;
select is((select count(*)::int from public.roster_entries where fantasy_team_id=pg_temp.v_id('team2') and released_at is null),10,'status correction preserves existing athletes');
select is((select is_varsity from public.profiles where id=pg_temp.v_id('user2')),true,'coaches receive the varsity badge');
select set_config('request.jwt.claim.sub',pg_temp.v_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user2'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user2'))::text,true);
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.get_beta_lineup(pg_temp.v_id('team2'))->'entries')e where (e->>'participation_conflict')::boolean),2,'lineup identifies both existing teammates requiring replacement');
reset role;
-- - Simulate prior ownership and a correction between two completed games
update public.fantasy_periods set starts_at=clock_timestamp()-interval '5 hours',ends_at=clock_timestamp()+interval '5 hours' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;
update public.roster_entries set acquired_at=clock_timestamp()-interval '4 hours' where fantasy_team_id=pg_temp.v_id('team2');
update public.roster_slot_history set effective_at=clock_timestamp()-interval '4 hours' where roster_entry_id in (select id from public.roster_entries where fantasy_team_id=pg_temp.v_id('team2'));
update beta_private.account_participation_history set effective_at=clock_timestamp()-interval '2 hours' where user_id=pg_temp.v_id('user2') and revision=2;
insert into public.teams(id,competition_id,name,short_name) values(pg_temp.v_id('opponent'),pg_temp.v_id('womens_volleyball'),'Opponent','OPP');
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,lineup_lock_at,status)
values(pg_temp.v_id('prior-game'),pg_temp.v_id('womens_volleyball'),pg_temp.v_id('womens_volleyball-team'),pg_temp.v_id('opponent'),clock_timestamp()-interval '3 hours',clock_timestamp()-interval '3 hours','final'),
(pg_temp.v_id('subsequent-game'),pg_temp.v_id('womens_volleyball'),pg_temp.v_id('womens_volleyball-team'),pg_temp.v_id('opponent'),clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour','final');
insert into public.fantasy_point_events(league_id,fantasy_team_id,athlete_id,game_id,ruleset_id,stat_key,stat_value,points,kind,source_identity)
select pg_temp.v_id('league'),pg_temp.v_id('team2'),pg_temp.v_id('womens_volleyball1'),pg_temp.v_id('prior-game'),ruleset_id,'volleyball.digs',28,7,'score','varsity-earned-points' from public.leagues where id=pg_temp.v_id('league');
-- - Exercise participation history only within a published scoring period
insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id)
select pg_temp.v_id('league'),number,starts_at,ends_at,pg_temp.v_id('team1'),pg_temp.v_id('team2') from public.fantasy_periods
where season_id='b0000000-0000-4000-8000-000000000002' and number=1;
select beta_private.snapshot_locks(pg_temp.v_id('league'));
select is((select count(*)::int from public.game_lineup_snapshots where game_id=pg_temp.v_id('prior-game')),2,'games before the participation change retain their starting assignments');
select is((select count(*)::int from public.game_lineup_snapshots where game_id=pg_temp.v_id('subsequent-game')),0,'conflicting athletes cannot enter games starting after the participation change');
select is((select sum(points) from public.fantasy_point_events where fantasy_team_id=pg_temp.v_id('team2')),7::numeric,'classification preserves points already earned');
update beta_private.account_participation set role='athlete',revision=revision+1,updated_at=clock_timestamp() where user_id=pg_temp.v_id('user2');
select beta_private.snapshot_locks(pg_temp.v_id('league'));
select is((select count(*)::int from public.game_lineup_snapshots where game_id=pg_temp.v_id('subsequent-game')),0,'a later participation correction cannot retroactively make a forbidden game eligible');
set local role authenticated;
select throws_ok($$select public.set_period_lineup(pg_temp.v_id('team2'),(select jsonb_agg(jsonb_build_object('athlete_id',athlete_id,'slot_code',slot_code)) from public.roster_entries where fantasy_team_id=pg_temp.v_id('team2') and released_at is null),(select state_version from public.leagues where id=pg_temp.v_id('league')),'varsity-conflicting-lineup')$$,'P0001','Replace athletes from your own varsity program before saving your next lineup','a conflicting roster cannot save its next lineup');
select throws_ok($$select public.add_free_agent(pg_temp.v_id('team2'),pg_temp.v_id('womens_volleyball3'),pg_temp.v_id('womens_volleyball1'),'varsity-forbidden-add')$$,'23514','Varsity athletes and coaches cannot acquire athletes from their own program','free-agent additions cannot bypass affiliations');
reset role;
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type,released_at) values(pg_temp.v_id('league'),pg_temp.v_id('team3'),pg_temp.v_id('womens_volleyball3'),'BN','bench','add',clock_timestamp());
set local role authenticated;
select throws_ok($$select public.request_waiver(pg_temp.v_id('team2'),pg_temp.v_id('womens_volleyball3'),pg_temp.v_id('womens_volleyball1'),'varsity-forbidden-claim')$$,'23514','Varsity athletes and coaches cannot acquire athletes from their own program','waiver claims cannot bypass affiliations');
select lives_ok($$select public.add_free_agent(pg_temp.v_id('team2'),pg_temp.v_id('mens_volleyball3'),pg_temp.v_id('womens_volleyball1'),'varsity-replace-first')$$,'a legal other-program replacement can resolve a conflict');
select lives_ok($$select public.add_free_agent(pg_temp.v_id('team2'),pg_temp.v_id('mens_volleyball4'),pg_temp.v_id('womens_volleyball2'),'varsity-replace-second')$$,'all conflicting athletes can be replaced atomically');
select lives_ok($$select public.set_period_lineup(pg_temp.v_id('team2'),(select jsonb_agg(jsonb_build_object('athlete_id',athlete_id,'slot_code',slot_code)) from public.roster_entries where fantasy_team_id=pg_temp.v_id('team2') and released_at is null),(select state_version from public.leagues where id=pg_temp.v_id('league')),'varsity-valid-lineup')$$,'replacement restores valid lineup saving');
reset role;
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type) values(pg_temp.v_id('league'),pg_temp.v_id('team3'),pg_temp.v_id('womens_volleyball4'),'VB_HT','starter','add');
set local role authenticated;
select throws_ok($$select public.propose_trade(pg_temp.v_id('team2'),pg_temp.v_id('team3'),array[pg_temp.v_id('mens_volleyball3')],array[pg_temp.v_id('womens_volleyball4')],now()+interval '1 day','varsity-forbidden-trade')$$,'23514','Varsity athletes and coaches cannot acquire athletes from their own program','trade proposals cannot acquire teammates');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
reset role;
delete from public.matchups where league_id=pg_temp.v_id('league');
update public.fantasy_periods set starts_at=clock_timestamp()+interval '1 day',ends_at=clock_timestamp()+interval '2 days' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;
update public.drafts set status='complete' where league_id=pg_temp.v_id('league');
set local role authenticated;
select throws_ok($$select public.generate_matchup_schedule(pg_temp.v_id('league'),now(),2,'varsity-two-cycles')$$,'P0001','Eight-manager leagues use one round-robin cycle','eight-manager leagues cannot request two cycles');
select lives_ok($$select public.generate_matchup_schedule(pg_temp.v_id('league'),now(),1,'varsity-one-cycle')$$,'eight-manager schedule generates one cycle');
select is((select count(*)::int from public.matchups where league_id=pg_temp.v_id('league')),28,'one cycle produces twenty-eight matchups');
select is((select count(distinct period)::int from public.matchups where league_id=pg_temp.v_id('league')),7,'one cycle spans seven rounds');
select is((select count(*)::int from (select least(home_team_id,away_team_id),greatest(home_team_id,away_team_id) from public.matchups where league_id=pg_temp.v_id('league') group by 1,2 having count(*)>1)r),0,'no pairing repeats');
reset role;
insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id)
select league_id,8,clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',home_team_id,away_team_id from public.matchups where league_id=pg_temp.v_id('league') and period=1 order by home_team_id limit 1;
insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id,status)
select league_id,8,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',home_team_id,away_team_id,'final' from public.matchups where league_id=pg_temp.v_id('league') and period=1 order by home_team_id limit 1 offset 1;
select is(beta_private.repair_eight_team_schedule(pg_temp.v_id('league')),1,'upgrade removes the unplayed future duplicate round');
select is((select count(*)::int from public.matchups where league_id=pg_temp.v_id('league') and period=8 and status='final'),1,'upgrade preserves played matchup history');
select is(beta_private.repair_eight_team_schedule(pg_temp.v_id('league')),0,'schedule repair is idempotent');
-- - Verify the single-sport draft path uses the same saved timer contract
insert into public.leagues(id,competition_id,ruleset_id,commissioner_id,name,format,max_members,invite_code)
values(pg_temp.v_id('legacy-timer-league'),pg_temp.v_id('mens_hockey'),'b0000000-0000-4000-8000-000000000004',pg_temp.v_id('user1'),'Legacy timer fixture','head_to_head',2,'LEGACYTIMER');
insert into public.league_members(league_id,user_id,role) select pg_temp.v_id('legacy-timer-league'),pg_temp.v_id('user'||n),case when n=1 then 'commissioner'::public.league_member_role else 'member'::public.league_member_role end from generate_series(1,2)n;
insert into public.fantasy_teams(id,league_id,owner_id,name,draft_position) select pg_temp.v_id('legacy-timer-team'||n),pg_temp.v_id('legacy-timer-league'),pg_temp.v_id('user'||n),'Legacy timer team '||n,n from generate_series(1,2)n;
set local role authenticated;
select lives_ok($$select public.set_league_pick_duration(pg_temp.v_id('legacy-timer-league'),20,(select state_version from public.leagues where id=pg_temp.v_id('legacy-timer-league')),'legacy-timer-save')$$,'single-sport commissioner can save the minimum timer');
select throws_ok($$select public.start_draft(pg_temp.v_id('legacy-timer-league'),10,120,'legacy-wrong-timer')$$,'P0001','Draft configuration must match the league ruleset','single-sport start rejects an unsaved duration');
select lives_ok($$select public.start_draft(pg_temp.v_id('legacy-timer-league'),10,20,'legacy-timer-start')$$,'single-sport draft starts with its saved timer');
select is((select pick_seconds from public.drafts where league_id=pg_temp.v_id('legacy-timer-league')),20,'single-sport draft snapshots the saved duration');
select is((select extract(epoch from pick_deadline-starts_at)::integer from public.drafts where league_id=pg_temp.v_id('legacy-timer-league')),20,'single-sport first deadline uses the saved duration');
reset role;
select * from finish();
rollback;
