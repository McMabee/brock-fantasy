begin;
select plan(30);

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('30000000-0000-4000-8000-000000000001', 'commissioner@example.test', '{"display_name":"Test Commissioner"}', now(), now(), now()),
  ('30000000-0000-4000-8000-000000000002', 'manager@example.test', '{"display_name":"Test Manager"}', now(), now(), now());

select is(
  (select display_name from public.profiles where id = '30000000-0000-4000-8000-000000000001'),
  'Test Commissioner',
  'auth signup creates a minimized profile'
);

insert into public.user_roles (user_id, role)
values ('30000000-0000-4000-8000-000000000001', 'admin');
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
select is(public.current_user_is_admin(), false, 'admin role without MFA is not authorized');
select throws_ok(
  $$select public.set_competition_ingestion_status('20000000-0000-4000-8000-000000000001', true, 'Provider outage under investigation', 'incident-pause-0001')$$,
  'Administrator with MFA required',
  'admin without MFA cannot pause competition ingestion'
);
select set_config('request.jwt.claim', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select is(public.current_user_is_admin(), true, 'admin role with AAL2 is authorized');
select lives_ok(
  $$select public.set_competition_ingestion_status('20000000-0000-4000-8000-000000000001', true, 'Provider outage under investigation', 'incident-pause-0001')$$,
  'AAL2 administrator pauses one competition'
);
select is(
  (select ingestion_paused from public.competition_ingestion_controls where competition_id = '20000000-0000-4000-8000-000000000001'),
  true,
  'competition records the ingestion pause'
);
select lives_ok(
  $$select public.set_competition_ingestion_status('20000000-0000-4000-8000-000000000001', true, 'Provider outage under investigation', 'incident-pause-0001')$$,
  'duplicate pause command returns its committed response'
);
select is(
  (select count(*)::integer from public.audit_log where request_id = 'incident-pause-0001'),
  1,
  'idempotent pause creates one audit event'
);
select lives_ok(
  $$select public.set_competition_ingestion_status('20000000-0000-4000-8000-000000000001', false, 'Provider feed reconciled', 'incident-resume-0001')$$,
  'AAL2 administrator resumes one competition'
);
select is(
  (select ingestion_paused from public.competition_ingestion_controls where competition_id = '20000000-0000-4000-8000-000000000001'),
  false,
  'competition clears the ingestion pause'
);
delete from public.user_roles where user_id = '30000000-0000-4000-8000-000000000001';

insert into public.teams (id, competition_id, name, short_name, is_brock)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Brock Test', 'BRO', true),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Opponent Test', 'OPP', false);

insert into public.athletes (id, competition_id, team_id, display_name, position)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Forward One', 'F'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Forward Two', 'F'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'Forward Three', 'F');

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
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

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
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

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
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
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
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

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
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
