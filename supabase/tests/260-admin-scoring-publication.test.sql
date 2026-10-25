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


-- - Exercise the public command and canonical player totals without fantasy ownership
create function pg_temp.score_lines(goals integer, incomplete boolean default false) returns jsonb language sql as $$
select jsonb_build_array(jsonb_build_object('athlete_id','98000000-0000-4000-8000-000000000010',
  'stats',jsonb_build_object('goals',goals,'assists',0,'power_play_goals',0,'short_handed_goals',0)
    || case when incomplete then '{}'::jsonb else '{"penalty_minutes":0}'::jsonb end));
$$;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select is((public.preview_game_revision('98000000-0000-4000-8000-000000000021',1,pg_temp.score_lines(1))->'players'->0->>'projected_points')::numeric,20::numeric,'preview calculates the entered line');
reset role;
select is((select count(*) from public.normalized_player_game_stats),0::bigint,'preview does not persist any statistics');
set local role authenticated;
select lives_ok($$select public.publish_game_revision(
 '98000000-0000-4000-8000-000000000021',1,'final',2,1,pg_temp.score_lines(1),
 'Reviewed official game stats','https://gobadgers.ca/boxscore?reference='||repeat('a',250),'publish-test-one')$$,'publication accepts full official source URLs');
reset role;
select is((select fantasy_points from public.normalized_player_game_stats where game_id='98000000-0000-4000-8000-000000000021' and athlete_id='98000000-0000-4000-8000-000000000010'),20::numeric,'publication immediately calculates player points without fantasy ownership');
select is((select count(*) from public.fantasy_point_events),0::bigint,'unowned players earn canonical points without team points');
select is((select payload->>'source_reference' from public.source_imports where kind='game_revision'),'https://gobadgers.ca/boxscore?reference='||repeat('a',250),'full source provenance is retained');
set local role authenticated;
select is((public.publish_game_revision('98000000-0000-4000-8000-000000000021',1,'final',2,1,pg_temp.score_lines(1),'Reviewed official game stats','https://gobadgers.ca/boxscore?reference='||repeat('a',250),'publish-test-one')->'players'->0->>'fantasy_points')::numeric,20::numeric,'retry returns the original saved player scoring receipt');
select is((public.get_player_insights('98000000-0000-4000-8000-000000000007','98000000-0000-4000-8000-000000000010')->0->>'seasonPoints')::numeric,20::numeric,'player insights immediately reflect the published points');
select is((public.preview_game_revision('98000000-0000-4000-8000-000000000021',2,pg_temp.score_lines(2))->'players'->0->>'previous_points')::numeric,20::numeric,'correction preview uses canonical points for an unowned player');
select is((public.preview_game_revision('98000000-0000-4000-8000-000000000021',2,pg_temp.score_lines(2))->'players'->0->>'point_difference')::numeric,25::numeric,'correction preview reports the actual player point difference');
select lives_ok($$select public.publish_game_revision('98000000-0000-4000-8000-000000000021',2,'final',3,1,pg_temp.score_lines(2),'Reviewed corrected box score','Official source','publish-test-correction')$$,'correction publishes atomically');
reset role;
select is((select fantasy_points from public.normalized_player_game_stats where game_id='98000000-0000-4000-8000-000000000021'),45::numeric,'correction replaces the canonical total without double counting');
select is((select count(*) from public.stat_revisions),1::bigint,'the previous statistics are retained for audit');
-- - Multiple leagues cannot multiply the athlete baseline in a correction preview
insert into public.fantasy_point_events(league_id,fantasy_team_id,athlete_id,game_id,ruleset_id,stat_key,stat_value,points,kind,source_identity)
select league_id,id,'98000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000021','b0000000-0000-4000-8000-000000000004','fixture.points',1,45,'score','two-league-preview'
from public.fantasy_teams;
set local role authenticated;
select is((public.preview_game_revision('98000000-0000-4000-8000-000000000021',3,pg_temp.score_lines(2))->'players'->0->>'previous_points')::numeric,45::numeric,'preview does not multiply points by fantasy league ownership');
reset role;

set local role authenticated;
select throws_ok($$select public.publish_game_revision('98000000-0000-4000-8000-000000000021',2,'final',3,1,pg_temp.score_lines(2),'Reviewed corrected box score','Official source','stale-publication')$$,'PT409','Game changed; reload and retry','stale game versions reject publication');
select is((public.publish_game_revision('98000000-0000-4000-8000-000000000021',3,'final',3,1,pg_temp.score_lines(2,true),'Source missing penalty minutes','Official source','publish-test-pending')->'replay'->>'incomplete')::boolean,true,'incomplete unowned player lines report pending scoring');
reset role;
select ok((select not stats_complete from public.games where id='98000000-0000-4000-8000-000000000021'),'game completeness includes unowned athletes');
select ok((select fantasy_points is null and not complete from public.normalized_player_game_stats where game_id='98000000-0000-4000-8000-000000000021'),'missing statistics are not treated as zero points');
set local role authenticated;
select lives_ok($$select public.publish_game_revision('98000000-0000-4000-8000-000000000021',4,'final',3,1,pg_temp.score_lines(2),'Missing statistic now verified','Official source','publish-test-complete')$$,'supplying the missing statistic completes scoring');
reset role;
select ok((select stats_complete from public.games where id='98000000-0000-4000-8000-000000000021'),'complete publication clears pending state');
select is((select state_version from public.games where id='98000000-0000-4000-8000-000000000021'),5::bigint,'retries and rejected commands do not increment the game version');
select * from finish();
rollback;
