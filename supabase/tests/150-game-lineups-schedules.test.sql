begin;
select no_plan();
-- - Exercise actual API roles with rollback-only fixtures
insert into beta_private.application_access(email,reason) values
('game-member@example.test','Explicit isolated RPC member approval'),('game-other@example.test','Explicit isolated RPC other approval');
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select id, email, now(), jsonb_build_object('display_name', 'RPC test user', 'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,
  'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
  'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now()
from (values
  ('98000000-0000-4000-8000-000000000001'::uuid, 'game-member@example.test'),
  ('98000000-0000-4000-8000-000000000002'::uuid, 'game-other@example.test')
) as fixture(id, email);
insert into auth.sessions(id,user_id,aal) values
('98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','aal1'),
('98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000002','aal2');
insert into public.user_roles (user_id, role)
values ('98000000-0000-4000-8000-000000000001', 'admin'),('98000000-0000-4000-8000-000000000002', 'admin');
insert into public.sports (id, code, name)
values ('98000000-0000-4000-8000-000000000003', 'hockey', 'RPC test sport');
insert into public.scoring_rulesets (id, sport, name, version, status, approved_at)
values ('98000000-0000-4000-8000-000000000004', 'hockey', 'RPC test rules', 1, 'approved', now());
insert into public.competitions (id, sport_id, division, name, season_label, ruleset_id, is_active)
values ('98000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000003',
  'mens', 'RPC test competition', '2026-27', '98000000-0000-4000-8000-000000000004', true);
insert into public.leagues (id, name, commissioner_id, competition_id, ruleset_id, format, invite_code)
values ('98000000-0000-4000-8000-000000000006', 'RPC private league', '98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000004', 'head_to_head', gen_random_uuid());
insert into public.league_members (league_id, user_id, role)
values ('98000000-0000-4000-8000-000000000006', '98000000-0000-4000-8000-000000000001', 'commissioner');

-- - Include completed drafts outside the caller league
insert into public.player_pools (id, season_id, ruleset_id, name, is_active)
values ('98000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000004', 'RPC ADP test pool', true);
update public.leagues set pool_id = '98000000-0000-4000-8000-000000000007'
where id = '98000000-0000-4000-8000-000000000006';
insert into public.leagues (id, name, commissioner_id, competition_id, ruleset_id, format, invite_code, pool_id)
values ('98000000-0000-4000-8000-000000000008', 'RPC other league', '98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000005', '98000000-0000-4000-8000-000000000004', 'head_to_head', gen_random_uuid(),
  '98000000-0000-4000-8000-000000000007');
insert into public.league_members (league_id, user_id, role)
values ('98000000-0000-4000-8000-000000000008', '98000000-0000-4000-8000-000000000002', 'commissioner');
insert into public.teams (id, competition_id, name, short_name)
values ('98000000-0000-4000-8000-000000000009', '98000000-0000-4000-8000-000000000005', 'RPC athlete team', 'RPC');
insert into public.athletes (id, competition_id, team_id, display_name, position)
values ('98000000-0000-4000-8000-000000000010', '98000000-0000-4000-8000-000000000005',
  '98000000-0000-4000-8000-000000000009', 'RPC ADP athlete', 'F');
insert into public.fantasy_teams (id, league_id, owner_id, name)
values ('98000000-0000-4000-8000-000000000011', '98000000-0000-4000-8000-000000000006', '98000000-0000-4000-8000-000000000001', 'RPC first team'),
       ('98000000-0000-4000-8000-000000000012', '98000000-0000-4000-8000-000000000008', '98000000-0000-4000-8000-000000000002', 'RPC other team');
insert into public.pool_competitions(pool_id,competition_id) values
  ('98000000-0000-4000-8000-000000000007','98000000-0000-4000-8000-000000000005');
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible) values
  ('98000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000002',
   '98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009',array['F'],true);

-- - Use a bounded active period and the next period independently of the wall-clock date
update public.fantasy_periods set starts_at=clock_timestamp()-interval '2 days',ends_at=clock_timestamp()+interval '2 days' where number=1;
update public.fantasy_periods set starts_at=clock_timestamp()+interval '2 days',ends_at=clock_timestamp()+interval '8 days' where number=2;
update public.leagues set status='active',ruleset_id='b0000000-0000-4000-8000-000000000004' where id='98000000-0000-4000-8000-000000000006';
update public.player_pools set ruleset_id='b0000000-0000-4000-8000-000000000004' where id='98000000-0000-4000-8000-000000000007';
insert into public.teams(id,competition_id,name,short_name) values('98000000-0000-4000-8000-000000000019','98000000-0000-4000-8000-000000000005','Opponent','OPP');
insert into public.athletes(id,competition_id,team_id,display_name,position) values('98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009','Bench athlete','F');
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible) values('98000000-0000-4000-8000-000000000020','b0000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009',array['F'],true);
insert into public.athlete_season_summaries(athlete_id,season_label,source,kind,fantasy_points,games_played) values('98000000-0000-4000-8000-000000000010','2026-27','Fixture','supplied_projection',100,10);
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status)
select id,'98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009','98000000-0000-4000-8000-000000000019',at,status::public.game_status from (values
 ('98000000-0000-4000-8000-000000000021'::uuid,clock_timestamp()-interval '1 hour','final'),
 ('98000000-0000-4000-8000-000000000022'::uuid,clock_timestamp()+interval '3 days','scheduled'),
 ('98000000-0000-4000-8000-000000000023'::uuid,clock_timestamp()+interval '4 days','scheduled')) fixture(id,at,status);
select is((select slot_count from public.roster_slot_rules where ruleset_id='b0000000-0000-4000-8000-000000000004' and slot_code='BN'),3,'three bench spots');
select is((select allowed_positions from public.roster_slot_rules where ruleset_id='b0000000-0000-4000-8000-000000000004' and slot_code='FLEX'),array['F','D','G','BC','FC','HT','L','S'],'FLEX permits every position including goalies');
select is((select points from beta_private.next_period_projections('98000000-0000-4000-8000-000000000007') where athlete_id='98000000-0000-4000-8000-000000000010'),20::numeric,'projection uses two games in the next period');
update public.games set status='cancelled' where id='98000000-0000-4000-8000-000000000023';
select is((select points from beta_private.next_period_projections('98000000-0000-4000-8000-000000000007') where athlete_id='98000000-0000-4000-8000-000000000010'),10::numeric,'cancelled games are excluded');
update public.games set status='postponed' where id='98000000-0000-4000-8000-000000000022';
select is((select points from beta_private.next_period_projections('98000000-0000-4000-8000-000000000007') where athlete_id='98000000-0000-4000-8000-000000000010'),0::numeric,'known zero-game period projects zero');
update public.games set status='scheduled',schedule_confirmed=false where id='98000000-0000-4000-8000-000000000022';
select ok((select pending from beta_private.next_period_projections('98000000-0000-4000-8000-000000000007') where athlete_id='98000000-0000-4000-8000-000000000010'),'unconfirmed games mark dependent projection pending');
select ok((select points is null from beta_private.next_period_projections('98000000-0000-4000-8000-000000000007') where athlete_id='98000000-0000-4000-8000-000000000020'),'missing inputs are unavailable');
select beta_private.refresh_projection_alerts();
select is((select count(*)::integer from public.sync_errors where error_code='MISSING_PERIOD_PROJECTION' and resolved_at is null),1,'missing projection creates an admin alert');
select beta_private.refresh_projection_alerts();
select is((select count(*)::integer from public.sync_errors where error_code='MISSING_PERIOD_PROJECTION' and resolved_at is null),1,'repeated alerts are deduplicated');
insert into public.athlete_season_summaries(athlete_id,season_label,source,kind,fantasy_points,games_played) values('98000000-0000-4000-8000-000000000020','2026-27','Fixture','supplied_projection',50,10);
select beta_private.refresh_projection_alerts();
select is((select count(*)::integer from public.sync_errors where error_code='MISSING_PERIOD_PROJECTION' and resolved_at is null),0,'corrected data resolves the alert');

insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquired_at,acquisition_type)
values('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000010','HK_F','starter',clock_timestamp()-interval '2 hours','draft'),
('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000020','BN','bench',clock_timestamp()-interval '2 hours','draft');
-- - Only published scoring periods admit game snapshots and fantasy points
insert into public.fantasy_teams(id,league_id,owner_id,name)
values('98000000-0000-4000-8000-000000000030','98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000002','Scoring fixture opponent');
insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id)
select '98000000-0000-4000-8000-000000000006',number,starts_at,ends_at,'98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000030'
from public.fantasy_periods where season_id='b0000000-0000-4000-8000-000000000002'and number in(1,2);
select beta_private.snapshot_locks('98000000-0000-4000-8000-000000000006');
select is((select count(*)::integer from public.game_lineup_snapshots),2,'game snapshot captures both starters and bench');
select ok(not beta_private.is_locked('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000010'),'finished first game does not lock the period');
insert into public.normalized_player_game_stats(game_id,athlete_id,source_identity,stats)
select '98000000-0000-4000-8000-000000000021',athlete_id,'fixture-one','{"goals":1,"assists":0,"power_play_goals":0,"short_handed_goals":0,"penalty_minutes":0}' from public.roster_entries;
select beta_private.replay_beta_game('98000000-0000-4000-8000-000000000021','fixture-score-one');
select is((select sum(points) from public.fantasy_point_events),20::numeric,'only the captured starter scores');
update public.roster_entries set slot_code=case when slot_code='BN' then 'HK_F' else 'BN' end,status=case when status='bench' then 'starter'::public.roster_status else 'bench'::public.roster_status end;
update public.games set starts_at=clock_timestamp()+interval '100 milliseconds',status='in_progress' where id='98000000-0000-4000-8000-000000000022';
select pg_sleep(0.15);
select beta_private.snapshot_locks('98000000-0000-4000-8000-000000000006');
select ok(beta_private.is_locked('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000020'),'next game locks bench and starter athletes');
insert into public.normalized_player_game_stats(game_id,athlete_id,source_identity,stats)
select '98000000-0000-4000-8000-000000000022',athlete_id,'fixture-two','{"goals":1,"assists":0,"power_play_goals":0,"short_handed_goals":0,"penalty_minutes":0}' from public.roster_entries;
select beta_private.replay_beta_game('98000000-0000-4000-8000-000000000022','fixture-score-two');
select is((select sum(points) from public.fantasy_point_events),40::numeric,'substitution retains first-game points and adds the new starter');
select is((select sum(points) from public.fantasy_point_events where athlete_id='98000000-0000-4000-8000-000000000010'),20::numeric,'original starter retains earned points without scoring while benched');
select beta_private.replay_beta_game('98000000-0000-4000-8000-000000000022','fixture-score-two-retry');
select is((select sum(points) from public.fantasy_point_events),40::numeric,'replay is idempotent after substitution');
update public.games set status='postponed' where id='98000000-0000-4000-8000-000000000022';
select ok(not beta_private.is_locked('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000020'),'postponement unlocks the athlete');
select ok((select lineup_lock_at<=clock_timestamp() from public.games where id='98000000-0000-4000-8000-000000000022'),'scored postponement retains its historical lock');
select is((select count(*)::integer from public.game_lineup_snapshots where game_id='98000000-0000-4000-8000-000000000022'),2,'scored postponement retains both historical assignments');
select is((select sum(points) from public.fantasy_point_events),40::numeric,'scored postponement preserves earned points');
select is((select fantasy_points from public.normalized_player_game_stats where game_id='98000000-0000-4000-8000-000000000021' and athlete_id='98000000-0000-4000-8000-000000000020'),20::numeric,'athlete season stats exist even for a benched game');

select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"98000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is(jsonb_array_length(public.get_player_insights('98000000-0000-4000-8000-000000000007')),2,'ordinary participants can read insights');
select is((public.get_player_insights('98000000-0000-4000-8000-000000000007','98000000-0000-4000-8000-000000000020')->0->'seasonStats'->>'goals')::numeric,2::numeric,'insights aggregate published canonical statistics once per game');
select throws_ok($$select public.get_schedule_review()$$,'42501','Administrator AAL2 access required','schedule review requires admin MFA');
select throws_ok($$select public.apply_official_schedule(gen_random_uuid(),'[]')$$,'42501',null,'participants cannot run the schedule worker');
select throws_ok($$insert into public.game_lineup_snapshots select * from public.game_lineup_snapshots$$,'42501',null,'snapshots cannot be forged by participants');
select throws_ok($$select public.set_period_lineup('98000000-0000-4000-8000-000000000011',null,(select state_version from public.leagues where id='98000000-0000-4000-8000-000000000006'),'null-lineup')$$,'P0001','Include each rostered athlete exactly once','null lineup cannot bypass the complete-roster contract');
select throws_ok($$select public.get_beta_lineup('98000000-0000-4000-8000-000000000012')$$,'P0001','Team owner access required','other team lineups cannot be edited through the owner command');
reset role;
insert into public.official_schedule_sources(id,competition_id,team_id,program,url) values('98000000-0000-4000-8000-000000000024','98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009','mens_hockey','https://gobadgers.ca/sports/mens-ice-hockey/schedule/2026-27?grid=true');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select lives_ok($$select public.get_schedule_review()$$,'MFA admin can read schedule and projection alerts');
select lives_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000023',1,'override',jsonb_build_object('starts_at',clock_timestamp()+interval '5 days','status','scheduled'),'Verified local override','pin-fixture')$$,'admin can pin a future schedule override');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000023','key','fixture:third','startsAt','2026-10-21T23:00:00Z','opponent','Opponent','home',true,'kind','regular','status','scheduled')))$$,'worker records conflicting official change');
select ok((select schedule_override and not schedule_confirmed from public.games where id='98000000-0000-4000-8000-000000000023'),'sync preserves pinned override and flags conflict pending confirmation');
select is((select schedule_revision from public.games where id='98000000-0000-4000-8000-000000000023'),3::bigint,'conflicting source increments revision once');
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000023','key','fixture:third','startsAt','2026-10-21T23:00:00Z','opponent','Opponent','home',true,'kind','regular','status','scheduled')));
select is((select schedule_revision from public.games where id='98000000-0000-4000-8000-000000000023'),3::bigint,'identical sync retry is idempotent');
reset role;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000023',2,'confirm','{}','Reviewed official schedule','stale-fixture')$$,'PT409','Schedule changed; reload and retry','stale confirmation cannot approve a newer source revision');
select lives_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000023',3,'confirm','{}','Reviewed official schedule','confirm-fixture')$$,'admin confirms the current revision');
select lives_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000023',3,'confirm','{}','Reviewed official schedule','confirm-fixture')$$,'confirmation retry is idempotent');
select lives_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000023',4,'clear_override','{}','Return to official schedule','clear-fixture')$$,'admin can clear an override for the next sync');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000023','key','fixture:third','startsAt','2026-10-21T23:00:00Z','opponent','Opponent','home',true,'kind','regular','status','scheduled')));
select ok((select not schedule_override and not schedule_confirmed and starts_at='2026-10-21T23:00:00Z'::timestamptz from public.games where id='98000000-0000-4000-8000-000000000023'),'cleared override accepts immediate source change pending confirmation');
reset role;
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select lives_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000023',6,'override','{"opponent":"Reviewed opponent","home":false,"neutral_site":true,"schedule_kind":"playoff"}','Corrected official fixture metadata','opponent-override')$$,'admin can override opponent, location and game phase');
reset role;
select ok((select away_team_id='98000000-0000-4000-8000-000000000009' and neutral_site and schedule_kind='playoff' from public.games where id='98000000-0000-4000-8000-000000000023'),'metadata override retains the mapped Brock program');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status)
values('98000000-0000-4000-8000-000000000026','98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009','98000000-0000-4000-8000-000000000019',clock_timestamp()-interval '1 minute','scheduled');
select beta_private.snapshot_locks('98000000-0000-4000-8000-000000000006');
select is((select count(*)::integer from public.game_lineup_snapshots where game_id='98000000-0000-4000-8000-000000000026'),2,'elapsed start captures an unplayed fixture before delayed postponement');
set local role service_role;
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000026','key','fixture:unplayed','startsAt',clock_timestamp()-interval '1 minute','opponent','Opponent','home',true,'kind','regular','status','postponed')));
select is((select count(*)::integer from public.game_lineup_snapshots where game_id='98000000-0000-4000-8000-000000000026'),0,'unplayed postponed fixture discards obsolete lineup capture');
select ok((select lineup_lock_at is null from public.games where id='98000000-0000-4000-8000-000000000026'),'delayed postponement clears the obsolete elapsed lock');
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000026','key','fixture:unplayed','startsAt','2026-10-22T23:00:00Z','opponent','Opponent','home',true,'kind','regular','status','scheduled')));
select is((select starts_at from public.games where id='98000000-0000-4000-8000-000000000026'),'2026-10-22T23:00:00Z'::timestamptz,'replacement start applies after postponement and will capture a fresh lineup');
select ok((select lineup_lock_at=starts_at from public.games where id='98000000-0000-4000-8000-000000000026'),'replacement fixture locks at its new start');
select ok(not beta_private.is_locked('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000010'),'athletes remain unlocked before the replacement start');
reset role;
update public.roster_entries set slot_code=case when slot_code='BN' then 'HK_F' else 'BN' end,status=case when status='bench' then 'starter'::public.roster_status else 'bench'::public.roster_status end;
set local role service_role;
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000026','key','fixture:unplayed','startsAt',clock_timestamp()+interval '100 milliseconds','opponent','Opponent','home',true,'kind','regular','status','scheduled')));
select pg_sleep(0.15);
reset role;
select beta_private.snapshot_locks('98000000-0000-4000-8000-000000000006');
select is((select status::text from public.game_lineup_snapshots where game_id='98000000-0000-4000-8000-000000000026' and athlete_id='98000000-0000-4000-8000-000000000010'),'starter','replacement start captures the intervening substitution');
insert into public.normalized_player_game_stats(game_id,athlete_id,source_identity,stats)
select '98000000-0000-4000-8000-000000000026',athlete_id,'replacement-fixture','{"goals":1,"assists":0,"power_play_goals":0,"short_handed_goals":0,"penalty_minutes":0}' from public.roster_entries;
select beta_private.replay_beta_game('98000000-0000-4000-8000-000000000026','replacement-score');
select is((select sum(points) from public.fantasy_point_events),60::numeric,'replacement starter scores while both earlier games retain their points');
update public.games set status='final' where id='98000000-0000-4000-8000-000000000026';
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status)
values('98000000-0000-4000-8000-000000000028','98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009','98000000-0000-4000-8000-000000000019',clock_timestamp()-interval '1 minute','postponed');
insert into public.normalized_player_game_stats(game_id,athlete_id,source_identity,stats)
values('98000000-0000-4000-8000-000000000028','98000000-0000-4000-8000-000000000010','published-before-capture','{}');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000026',4,'override',jsonb_build_object('status','scheduled','starts_at',clock_timestamp()+interval '3 days'),'Do not reopen a completed fixture','blocked-final')$$,'P0001','Completed-game schedules are protected','admin cannot reopen a completed fixture');
select throws_ok($$select public.review_game_schedule('98000000-0000-4000-8000-000000000028',1,'override',jsonb_build_object('status','scheduled','starts_at',clock_timestamp()+interval '3 days'),'Do not move published historical stats','blocked-stat-game')$$,'P0001','Started-game timing and opponents are protected','published stats protect game identity even before fantasy snapshots exist');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000026','key','fixture:unplayed','startsAt',clock_timestamp()+interval '3 days','opponent','Opponent','home',true,'kind','regular','status','postponed'),jsonb_build_object('id','98000000-0000-4000-8000-000000000028','key','fixture:published-stats','startsAt',clock_timestamp()+interval '3 days','opponent','Opponent','home',true,'kind','regular','status','scheduled')));
select ok((select status='final' from public.games where id='98000000-0000-4000-8000-000000000026'),'official postponement cannot regress a completed fixture');
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000026','key','fixture:unplayed','startsAt',clock_timestamp()+interval '3 days','opponent','Opponent','home',true,'kind','regular','status','scheduled')));
reset role;
select ok((select status='final' and starts_at<clock_timestamp() from public.games where id='98000000-0000-4000-8000-000000000026'),'official conflicts cannot reopen or move a completed fixture');
select ok((select starts_at<clock_timestamp() from public.games where id='98000000-0000-4000-8000-000000000028'),'official changes preserve published-stat game identity without a prior fantasy snapshot');
update public.games set status='final' where id='98000000-0000-4000-8000-000000000028';
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status)
values('98000000-0000-4000-8000-000000000027','98000000-0000-4000-8000-000000000005','98000000-0000-4000-8000-000000000009','98000000-0000-4000-8000-000000000019',clock_timestamp()-interval '1 minute','scheduled');
select beta_private.snapshot_locks('98000000-0000-4000-8000-000000000006');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select public.review_game_schedule('98000000-0000-4000-8000-000000000027',1,'override','{"status":"postponed"}','Confirmed delayed postponement','admin-postpone');
select ok((select lineup_lock_at is null from public.games where id='98000000-0000-4000-8000-000000000027'),'admin postponement also clears an unplayed elapsed lock');
select public.review_game_schedule('98000000-0000-4000-8000-000000000027',2,'override',jsonb_build_object('status','scheduled','starts_at',clock_timestamp()+interval '3 days'),'Verified replacement game start','admin-reschedule');
select ok((select lineup_lock_at=starts_at and lineup_lock_at>clock_timestamp() from public.games where id='98000000-0000-4000-8000-000000000027'),'admin replacement locks at the future start');
reset role;
select ok(not beta_private.is_locked('98000000-0000-4000-8000-000000000006','98000000-0000-4000-8000-000000000010'),'admin-rescheduled athletes are movable until replacement start');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.apply_official_schedule('98000000-0000-4000-8000-000000000024',jsonb_build_array(jsonb_build_object('id','98000000-0000-4000-8000-000000000027','key','fixture:pinned','startsAt',clock_timestamp()+interval '3 days','opponent','Opponent','home',true,'kind','regular','status','postponed')));
reset role;
select ok((select status='scheduled' and lineup_lock_at=starts_at from public.games where id='98000000-0000-4000-8000-000000000027'),'official postponement conflict retains the effective pinned schedule and lock');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"98000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select lives_ok($$select public.delete_league('98000000-0000-4000-8000-000000000006','RPC private league',(select state_version from public.leagues where id='98000000-0000-4000-8000-000000000006'),'delete-snapshot-league')$$,'league deletion cleans new snapshots before dependent roster cascades');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select public.get_player_insights('98000000-0000-4000-8000-000000000007')$$,'42501',null,'anonymous insights are denied');
reset role;
select * from finish();
rollback;
