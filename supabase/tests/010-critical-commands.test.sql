begin;
select plan(23);
insert into beta_private.application_access(email,reason) values
('commissioner@example.test','Explicit isolated commissioner approval'),('manager@example.test','Explicit isolated manager approval');
create function pg_temp.test_actor(p_id uuid,p_aal text default 'aal1') returns text language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',p_id::text,true);
  return set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','aal',p_aal,'session_id',p_id)::text,true);
end $$;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('30000000-0000-4000-8000-000000000001', 'commissioner@example.test', jsonb_build_object('display_name', 'Test Commissioner', 'beta_age_eligible', true, 'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer, 'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now(), now()),
  ('30000000-0000-4000-8000-000000000002', 'manager@example.test', jsonb_build_object('display_name', 'Test Manager', 'beta_age_eligible', true, 'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer, 'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now(), now());

select is(
  (select display_name from public.profiles where id = '30000000-0000-4000-8000-000000000001'),
  'Test Commissioner',
  'auth signup creates a minimized profile'
);
insert into auth.sessions(id,user_id,aal) values
('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','aal1'),
('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','aal1');

insert into public.user_roles (user_id, role)
values ('30000000-0000-4000-8000-000000000001', 'admin');
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select pg_temp.test_actor('30000000-0000-4000-8000-000000000001','aal1');
select is(public.current_user_is_admin(), false, 'admin role without MFA is not authorized');
select pg_temp.test_actor('30000000-0000-4000-8000-000000000001','aal2');
select is(public.current_user_is_admin(), true, 'admin role with AAL2 is authorized');
delete from public.user_roles where user_id = '30000000-0000-4000-8000-000000000001';

-- Isolated command fixture. Runtime seed data is intentionally empty.
insert into public.sports (id, code, name)
values ('00000000-0000-4000-8000-000000000001', 'hockey', 'Hockey');
insert into public.scoring_rulesets (
  id, sport, name, version, status, draft_config, transaction_config, matchup_config
) values (
  '10000000-0000-4000-8000-000000000001', 'hockey', 'Command test hockey', 1, 'draft',
  '{"pickSeconds":90,"autopickStrategy":"queued_then_ranked_legal"}',
  '{"freeAgentsEnabled":true,"waiversEnabled":true,"tradesEnabled":true}',
  '{"periodDays":7,"tiesAllowed":true,"tiebreaker":"points_for"}'
);
insert into public.roster_slot_rules (
  ruleset_id, slot_code, label, allowed_positions, slot_count, is_starter
) values (
  '10000000-0000-4000-8000-000000000001', 'BN', 'Bench', array['F','D','G'], 8, false
);
insert into public.competitions (
  id, sport_id, division, name, season_label, ruleset_id, is_active
) values (
  '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
  'mens', 'Command test hockey', '2026-27', '10000000-0000-4000-8000-000000000001', false
);

insert into public.teams (id, competition_id, name, short_name, is_brock)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Brock Test', 'BRO', true),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Opponent Test', 'OPP', false);

insert into public.athletes (id, competition_id, team_id, display_name, position)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Forward One', 'F'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Forward Two', 'F'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'Forward Three', 'F');

select pg_temp.test_actor('30000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.create_league('Blocked League', '20000000-0000-4000-8000-000000000001', 'head_to_head', 'blocked-create-0001')$$,
  'Competition does not have an active approved ruleset',
  'inactive competition cannot create a league'
);

update public.scoring_rulesets
set status = 'approved', approved_at = now()
where id = '10000000-0000-4000-8000-000000000001';
update public.competitions
set is_active = true
where id = '20000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.create_league('Critical Path League', '20000000-0000-4000-8000-000000000001', 'head_to_head', 'create-league-0001')$$,
  'commissioner creates an approved private league'
);
select lives_ok(
  $$select public.create_league('Critical Path League', '20000000-0000-4000-8000-000000000001', 'head_to_head', 'create-league-0001')$$,
  'duplicate create command returns its committed response'
);
select is(
  (select count(*)::integer from public.leagues where name = 'Critical Path League'),
  1,
  'idempotent create produces one league'
);
select is(
  (select count(*)::integer from public.league_members lm join public.leagues l on l.id = lm.league_id where l.name = 'Critical Path League'),
  1,
  'league creator is its initial member'
);

select pg_temp.test_actor('30000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::integer from public.leagues where name = 'Critical Path League'),
  0,
  'non-member cannot read a private league through RLS'
);
reset role;

select lives_ok(
  $$select public.join_league((select invite_code::text from public.leagues where name = 'Critical Path League'), 'Second Team', 'join-league-0001')$$,
  'manager joins with the private invite code'
);
select lives_ok(
  $$select public.join_league((select invite_code::text from public.leagues where name = 'Critical Path League'), 'Second Team', 'join-league-0001')$$,
  'duplicate join command returns its committed response'
);
select is(
  (select count(*)::integer from public.league_members lm join public.leagues l on l.id = lm.league_id where l.name = 'Critical Path League'),
  2,
  'idempotent join produces exactly two memberships'
);

set local role authenticated;
select is(
  (select count(*)::integer from public.leagues where name = 'Critical Path League'),
  1,
  'member can read the private league through RLS'
);
reset role;

select pg_temp.test_actor('30000000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.start_draft((select id from public.leagues where name = 'Critical Path League'), 8, 90, 'start-draft-0001')$$,
  'commissioner starts a draft using approved server rules'
);
select lives_ok(
  $$select public.start_draft((select id from public.leagues where name = 'Critical Path League'), 8, 90, 'start-draft-0001')$$,
  'duplicate draft start returns its committed response'
);
select is(
  (select count(*)::integer from public.drafts d join public.leagues l on l.id = d.league_id where l.name = 'Critical Path League'),
  1,
  'idempotent start creates one draft'
);

select lives_ok(
  $$select public.make_draft_pick((select d.id from public.drafts d join public.leagues l on l.id = d.league_id where l.name = 'Critical Path League'), '50000000-0000-4000-8000-000000000001', 'draft-pick-0001', 'manager')$$,
  'first draft pick commits atomically'
);
select pg_temp.test_actor('30000000-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.make_draft_pick((select d.id from public.drafts d join public.leagues l on l.id = d.league_id where l.name = 'Critical Path League'), '50000000-0000-4000-8000-000000000002', 'draft-pick-0002', 'manager')$$,
  'second draft pick commits atomically'
);
select lives_ok(
  $$select public.make_draft_pick((select d.id from public.drafts d join public.leagues l on l.id = d.league_id where l.name = 'Critical Path League'), '50000000-0000-4000-8000-000000000003', 'draft-pick-0003', 'manager')$$,
  'snake reversal gives the second manager the third pick'
);
select is(
  (select fantasy_team_id from public.draft_picks where overall_pick = 2),
  (select fantasy_team_id from public.draft_picks where overall_pick = 3),
  'round two reverses the pick order'
);

select pg_temp.test_actor('30000000-0000-4000-8000-000000000001');
select lives_ok(
  $$select public.make_draft_pick((select d.id from public.drafts d join public.leagues l on l.id = d.league_id where l.name = 'Critical Path League'), '50000000-0000-4000-8000-000000000001', 'draft-pick-0001', 'manager')$$,
  'duplicate pick retry returns the original committed result'
);
select is(
  (select count(*)::integer from public.draft_picks),
  3,
  'duplicate pick retry does not insert another row'
);
select is(
  (select count(*)::integer from public.roster_entries where released_at is null),
  3,
  'each committed pick has one active roster entry'
);

select * from finish();
rollback;
