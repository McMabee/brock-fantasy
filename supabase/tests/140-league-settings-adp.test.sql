begin;
select no_plan();
-- All fixtures and commands roll back. Exercise actual API roles, not postgres.
insert into beta_private.application_access(email,reason) values
('rpc-member@example.test','Explicit isolated RPC member approval'),('rpc-other@example.test','Explicit isolated RPC other approval');
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select id, email, now(), jsonb_build_object('display_name', 'RPC test user', 'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,
  'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
  'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now()
from (values
  ('99000000-0000-4000-8000-000000000001'::uuid, 'rpc-member@example.test'),
  ('99000000-0000-4000-8000-000000000002'::uuid, 'rpc-other@example.test')
) as fixture(id, email);
insert into auth.sessions(id,user_id,aal) values
('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','aal1'),
('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000002','aal2');
insert into public.user_roles (user_id, role)
values ('99000000-0000-4000-8000-000000000001', 'admin'),('99000000-0000-4000-8000-000000000002', 'admin');
insert into public.sports (id, code, name)
values ('99000000-0000-4000-8000-000000000003', 'hockey', 'RPC test sport');
insert into public.scoring_rulesets (id, sport, name, version, status, approved_at)
values ('99000000-0000-4000-8000-000000000004', 'hockey', 'RPC test rules', 1, 'approved', now());
insert into public.competitions (id, sport_id, division, name, season_label, ruleset_id, is_active)
values ('99000000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000003',
  'mens', 'RPC test competition', '2026-27', '99000000-0000-4000-8000-000000000004', true);
insert into public.leagues (id, name, commissioner_id, competition_id, ruleset_id, format, invite_code)
values ('99000000-0000-4000-8000-000000000006', 'RPC private league', '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000004', 'head_to_head', gen_random_uuid());
insert into public.league_members (league_id, user_id, role)
values ('99000000-0000-4000-8000-000000000006', '99000000-0000-4000-8000-000000000001', 'commissioner');

-- ADP intentionally includes completed drafts outside the caller's own leagues.
insert into public.player_pools (id, season_id, ruleset_id, name, is_active)
values ('99000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000004', 'RPC ADP test pool', true);
update public.leagues set pool_id = '99000000-0000-4000-8000-000000000007'
where id = '99000000-0000-4000-8000-000000000006';
insert into public.leagues (id, name, commissioner_id, competition_id, ruleset_id, format, invite_code, pool_id)
values ('99000000-0000-4000-8000-000000000008', 'RPC other league', '99000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000004', 'head_to_head', gen_random_uuid(),
  '99000000-0000-4000-8000-000000000007');
insert into public.league_members (league_id, user_id, role)
values ('99000000-0000-4000-8000-000000000008', '99000000-0000-4000-8000-000000000002', 'commissioner');
insert into public.teams (id, competition_id, name, short_name)
values ('99000000-0000-4000-8000-000000000009', '99000000-0000-4000-8000-000000000005', 'RPC athlete team', 'RPC');
insert into public.athletes (id, competition_id, team_id, display_name, position)
values ('99000000-0000-4000-8000-000000000010', '99000000-0000-4000-8000-000000000005',
  '99000000-0000-4000-8000-000000000009', 'RPC ADP athlete', 'F');
insert into public.fantasy_teams (id, league_id, owner_id, name)
values ('99000000-0000-4000-8000-000000000011', '99000000-0000-4000-8000-000000000006', '99000000-0000-4000-8000-000000000001', 'RPC first team'),
       ('99000000-0000-4000-8000-000000000012', '99000000-0000-4000-8000-000000000008', '99000000-0000-4000-8000-000000000002', 'RPC other team');
insert into public.pool_competitions(pool_id,competition_id) values
  ('99000000-0000-4000-8000-000000000007','99000000-0000-4000-8000-000000000005');
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible) values
  ('99000000-0000-4000-8000-000000000010','b0000000-0000-4000-8000-000000000002',
   '99000000-0000-4000-8000-000000000005','99000000-0000-4000-8000-000000000009',array['F'],true);
insert into public.drafts (id, league_id, status, rounds, pick_seconds, league_size, is_test)
values ('99000000-0000-4000-8000-000000000013', '99000000-0000-4000-8000-000000000006', 'complete', 1, 90, 4, false),
       ('99000000-0000-4000-8000-000000000014', '99000000-0000-4000-8000-000000000008', 'complete', 1, 90, 6, false);
insert into public.draft_picks (draft_id, fantasy_team_id, athlete_id, overall_pick, round, pick_in_round, source)
values ('99000000-0000-4000-8000-000000000013', '99000000-0000-4000-8000-000000000011', '99000000-0000-4000-8000-000000000010', 1, 1, 1, 'manager'),
       ('99000000-0000-4000-8000-000000000014', '99000000-0000-4000-8000-000000000012', '99000000-0000-4000-8000-000000000010', 3, 1, 3, 'autopick');


insert into public.athlete_season_summaries(athlete_id,season_label,source,kind,supplied_adp)
values('99000000-0000-4000-8000-000000000010','2026-27','ADP seed fixture','supplied_projection',10);
-- Include completed beta drafts, including the original is_test=true flag.
update public.drafts set is_test=true where id='99000000-0000-4000-8000-000000000014';
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"99000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is(public.get_athlete_adp('99000000-0000-4000-8000-000000000010','99000000-0000-4000-8000-000000000007'),
 '{"base":10,"average":4.67,"samples":2,"autopicks":1}'::jsonb,'supplied base is one seed and manual/autopicks from all beta leagues contribute');
select is(public.get_pool_adp('99000000-0000-4000-8000-000000000007')->'99000000-0000-4000-8000-000000000010'->>'average','4.67','catalog and individual ADP agree');
select is(public.get_draft_room_snapshot('99000000-0000-4000-8000-000000000013')->>'closed','true','completed draft room is closed');
select ok(not (public.get_draft_room_snapshot('99000000-0000-4000-8000-000000000013') ?| array['queue','players','candidates','roster','picks']),'completed room exposes no interactive room data');
select is(jsonb_array_length(public.get_draft_results('99000000-0000-4000-8000-000000000013')->'picks'),1,'members can read separate draft results');
select is(public.get_draft_results('99000000-0000-4000-8000-000000000013')->'picks'->0->>'team_name','RPC first team','results retain manager names');
select lives_ok($$select public.rename_my_fantasy_team('99000000-0000-4000-8000-000000000006','New team name','rename-fixture')$$,'AAL1 manager can rename their own team');
select lives_ok($$select public.rename_my_fantasy_team('99000000-0000-4000-8000-000000000006','New team name','rename-fixture')$$,'rename retries are idempotent');
select is((select name from public.fantasy_teams where id='99000000-0000-4000-8000-000000000011'),'New team name','rename persists');
select throws_ok($$select public.rename_my_fantasy_team('99000000-0000-4000-8000-000000000008','Other team name','rename-foreign')$$,'42501','Your league team is required','managers cannot rename another league team');
select throws_ok($$select public.rename_my_fantasy_team('99000000-0000-4000-8000-000000000006',' ','rename-empty')$$,'22023','Team name must be 3 to 60 characters','blank team names are rejected');
select throws_ok($$select public.get_draft_results('99000000-0000-4000-8000-000000000014')$$,'42501','Draft membership required','results enforce league membership');
reset role;
select is((select count(*)::integer from public.audit_log where action='team.renamed'),1,'rename retry creates one audit event');
update public.drafts set status='active' where id='99000000-0000-4000-8000-000000000014';
select is(beta_private.pool_adp('99000000-0000-4000-8000-000000000007')->'99000000-0000-4000-8000-000000000010'->>'average','5.50','unfinished drafts do not count');
update public.drafts set status='complete',voided_at=now() where id='99000000-0000-4000-8000-000000000014';
select is(beta_private.pool_adp('99000000-0000-4000-8000-000000000007')->'99000000-0000-4000-8000-000000000010'->>'samples','1','voided drafts are removed from ADP');
update public.drafts set voided_at=null where id='99000000-0000-4000-8000-000000000014';
update public.athlete_season_summaries set supplied_adp=null where source='ADP seed fixture';
select is(beta_private.pool_adp('99000000-0000-4000-8000-000000000007')->'99000000-0000-4000-8000-000000000010'->>'average','2.00','missing seeds use actual picks without fabricating a value');
update public.drafts set status='active' where id='99000000-0000-4000-8000-000000000013';
set local role authenticated;
select throws_ok($$select public.get_draft_results('99000000-0000-4000-8000-000000000013')$$,'22023','Draft results are available after completion','results remain unavailable while drafting');
reset role;
update public.drafts set status='complete' where id='99000000-0000-4000-8000-000000000013';
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type) values('99000000-0000-4000-8000-000000000006','99000000-0000-4000-8000-000000000011','99000000-0000-4000-8000-000000000010','F','starter','draft');
update public.athletes set fantasy_withdrawn_at=now(),status='inactive' where id='99000000-0000-4000-8000-000000000010';
set local role authenticated;
select is((select count(*)::integer from public.athletes where id='99000000-0000-4000-8000-000000000010'),0,'withdrawal restricts direct athlete reads even in active competitions');
select is(public.get_beta_lineup('99000000-0000-4000-8000-000000000011')->'entries'->0->>'display_name','Unavailable athlete','lineup retains ownership without exposing a withdrawn athlete');
select ok(not(public.get_pool_adp('99000000-0000-4000-8000-000000000007') ? '99000000-0000-4000-8000-000000000010'),'withdrawn athlete is omitted from global ADP');
select is(public.get_draft_results('99000000-0000-4000-8000-000000000013')->'picks'->0->>'display_name','Unavailable athlete','historical results suppress withdrawn names and photos');
reset role;
select is((select count(*)::integer from public.draft_picks where athlete_id='99000000-0000-4000-8000-000000000010'),2,'withdrawal preserves draft history');
select ok(not has_function_privilege('anon','public.get_pool_adp(uuid)','execute') and not has_function_privilege('anon','public.get_draft_results(uuid)','execute') and not has_function_privilege('anon','public.rename_my_fantasy_team(uuid,text,text)','execute'),'new public APIs deny anonymous callers');
select * from finish();
rollback;
