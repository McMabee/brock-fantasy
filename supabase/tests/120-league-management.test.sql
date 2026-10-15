begin;
select no_plan();

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select id, email, now(), jsonb_build_object('display_name', 'League command fixture',
  'beta_age_eligible', true,
  'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
  'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now()
from (values
  ('95000000-0000-4000-8000-000000000001'::uuid, 'league-owner@example.test'),
  ('95000000-0000-4000-8000-000000000002'::uuid, 'league-member@example.test'),
  ('95000000-0000-4000-8000-000000000003'::uuid, 'league-ordinary@example.test')
) fixture(id, email);
insert into auth.sessions(id, user_id, aal)
select id, id, 'aal2' from auth.users where email in
  ('league-owner@example.test', 'league-member@example.test', 'league-ordinary@example.test');
insert into public.user_roles(user_id, role) values
  ('95000000-0000-4000-8000-000000000001', 'admin'),
  ('95000000-0000-4000-8000-000000000002', 'admin');
create function pg_temp.league_actor(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'session_id', p_id,
    'role', 'authenticated', 'aal', 'aal2')::text, true);
end;
$$;
insert into public.fantasy_seasons(id, label, rule_version, trade_deadline)
values('95000000-0000-4000-8000-000000000004', 'League commands fixture', 'fixture', now() + interval '1 year');
insert into public.scoring_rulesets(id, name, version, status, approved_at)
values('95000000-0000-4000-8000-000000000005', 'League command rules', 1, 'approved', now());
insert into public.player_pools(id, season_id, name, ruleset_id, is_active)
values('95000000-0000-4000-8000-000000000006', '95000000-0000-4000-8000-000000000004',
  'League command pool', '95000000-0000-4000-8000-000000000005', true);
insert into public.fantasy_periods(id, season_id, number, starts_at, ends_at, phase)
values('95000000-0000-4000-8000-000000000007', '95000000-0000-4000-8000-000000000004', 1,
  now() + interval '1 day', now() + interval '8 days', 'regular');

select pg_temp.league_actor('95000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 4, 'league-missing-team')$$,
  '22023', 'Fantasy team name is required. Update the app and try again.',
  'the legacy signature cannot create another automatically named team');
select throws_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 4, 'league-null-team', null)$$,
  '22023', 'Team name must be 3 to 60 characters', 'null team names are rejected');
select throws_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 4, 'league-blank-team', '   ')$$,
  '22023', 'Team name must be 3 to 60 characters', 'blank team names are rejected');
select throws_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 4, 'league-long-team', repeat('x', 61))$$,
  '22023', 'Team name must be 3 to 60 characters', 'overlong team names are rejected');
select throws_ok($$select public.create_beta_league(null,
  '95000000-0000-4000-8000-000000000006', 4, 'league-null-name', 'Personal Team')$$,
  '22023', 'Invalid league name or size', 'null league names are rejected');
select throws_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 5, 'league-invalid-size', 'Personal Team')$$,
  '22023', 'Invalid league name or size', 'unsupported league sizes are rejected');
select lives_ok($$select public.create_beta_league(' League commands fixture ',
  '95000000-0000-4000-8000-000000000006', 4, 'league-create-qa-01', ' Personal Team ')$$,
  'creation saves the supplied league and team names in one transaction');
select lives_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 4, 'league-create-qa-01', 'A different team')$$,
  'creation retries return the committed response without renaming the team');
select lives_ok($$select public.create_beta_league('League commands fixture',
  '95000000-0000-4000-8000-000000000006', 4, 'league-create-qa-01')$$,
  'legacy retries can retrieve an already committed creation response');
reset role;
select set_config('test.league_id', (select id::text from public.leagues where name = 'League commands fixture'), true);
select is((select count(*)::integer from public.leagues where name = 'League commands fixture'), 1,
  'creation retry produces exactly one league');
select is((select name from public.fantasy_teams where league_id = current_setting('test.league_id')::uuid),
  'Personal Team', 'the creator team name is trimmed and independent of the league name');
select is((select count(*)::integer from public.audit_log where request_id = 'league-create-qa-01'), 1,
  'creation is audited once');
select is((select char_length(invite_code) from public.leagues where id = current_setting('test.league_id')::uuid),
  12, 'new league codes use the current twelve-character format');

-- Populate restrictive beta histories and cascaded league data so deletion
-- exercises an active league rather than only an empty setup league.
insert into public.league_members(league_id, user_id)
values(current_setting('test.league_id')::uuid, '95000000-0000-4000-8000-000000000002');
insert into public.fantasy_teams(id, league_id, owner_id, name)
values('95000000-0000-4000-8000-000000000008', current_setting('test.league_id')::uuid,
  '95000000-0000-4000-8000-000000000002', 'Member Team');
select set_config('test.owner_team_id', (select id::text from public.fantasy_teams
  where league_id = current_setting('test.league_id')::uuid and name = 'Personal Team'), true);
insert into public.sports(id, code, name) values('95000000-0000-4000-8000-000000000009', 'hockey', 'Fixture sport');
insert into public.competitions(id, sport_id, division, name, season_label, ruleset_id)
values('95000000-0000-4000-8000-000000000010', '95000000-0000-4000-8000-000000000009', 'mens',
  'League fixture competition', 'fixture', '95000000-0000-4000-8000-000000000005');
insert into public.teams(id, competition_id, name, short_name)
values('95000000-0000-4000-8000-000000000011', '95000000-0000-4000-8000-000000000010', 'Fixture team', 'FIX');
insert into public.athletes(id, competition_id, team_id, display_name, position)
values('95000000-0000-4000-8000-000000000012', '95000000-0000-4000-8000-000000000010',
  '95000000-0000-4000-8000-000000000011', 'Fixture athlete', 'F');
insert into public.roster_entries(id, league_id, fantasy_team_id, athlete_id, slot_code, status, acquisition_type)
values('95000000-0000-4000-8000-000000000013', current_setting('test.league_id')::uuid,
  current_setting('test.owner_team_id')::uuid, '95000000-0000-4000-8000-000000000012', 'BN', 'bench', 'draft');
insert into public.period_lineup_locks(league_id, fantasy_team_id, period_id, athlete_id, roster_entry_id, slot_code, status, locked_at)
values(current_setting('test.league_id')::uuid, current_setting('test.owner_team_id')::uuid,
  '95000000-0000-4000-8000-000000000007', '95000000-0000-4000-8000-000000000012',
  '95000000-0000-4000-8000-000000000013', 'BN', 'bench', now());
insert into public.trades(id, league_id, proposing_team_id, receiving_team_id, proposed_by, expires_at)
values('95000000-0000-4000-8000-000000000014', current_setting('test.league_id')::uuid,
  current_setting('test.owner_team_id')::uuid, '95000000-0000-4000-8000-000000000008',
  '95000000-0000-4000-8000-000000000001', now() + interval '1 day');
insert into public.trade_items(trade_id, from_team_id, to_team_id, athlete_id)
values('95000000-0000-4000-8000-000000000014', current_setting('test.owner_team_id')::uuid,
  '95000000-0000-4000-8000-000000000008', '95000000-0000-4000-8000-000000000012');
insert into public.trade_votes(trade_id, user_id)
values('95000000-0000-4000-8000-000000000014', '95000000-0000-4000-8000-000000000002');
insert into public.matchups(league_id, period, starts_at, ends_at, home_team_id, away_team_id, winner_team_id)
values(current_setting('test.league_id')::uuid, 1, now(), now() + interval '1 day',
  current_setting('test.owner_team_id')::uuid, '95000000-0000-4000-8000-000000000008',
  current_setting('test.owner_team_id')::uuid);
insert into public.drafts(id, league_id, rounds, pick_seconds)
values('95000000-0000-4000-8000-000000000015', current_setting('test.league_id')::uuid, 10, 120);
insert into public.draft_picks(draft_id, fantasy_team_id, athlete_id, overall_pick, round, pick_in_round, source)
values('95000000-0000-4000-8000-000000000015', current_setting('test.owner_team_id')::uuid,
  '95000000-0000-4000-8000-000000000012', 1, 1, 1, 'manager');
insert into public.chat_messages(league_id, author_id, body)
values(current_setting('test.league_id')::uuid, '95000000-0000-4000-8000-000000000001', 'League fixture chat');
update public.leagues set status = 'active' where id = current_setting('test.league_id')::uuid;
select public.create_beta_league('Unrelated surviving league', '95000000-0000-4000-8000-000000000006',
  4, 'league-survives-qa', 'Surviving Team');

select pg_temp.league_actor('95000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  'League commands fixture', 1, 'league-member-denied')$$,
  '42501', 'Commissioner access required', 'a member who is an AAL2 admin cannot delete the commissioner league');
reset role;
select pg_temp.league_actor('95000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  'League commands fixture', 1, 'league-access-denied')$$,
  '42501', 'Commissioner access required', 'ordinary participants cannot delete another commissioner league');
reset role;
select pg_temp.league_actor('95000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  null, 1, 'league-confirm-null')$$,
  '22023', 'Type the league name to confirm deletion', 'missing confirmation is rejected on the server');
select throws_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  'Wrong league', 1, 'league-confirm-wrong')$$,
  '22023', 'Type the league name to confirm deletion', 'incorrect confirmation is rejected on the server');
select throws_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  'League commands fixture', 0, 'league-confirm-stale')$$,
  '40001', 'League changed. Refresh league controls and confirm again.', 'a stale confirmation cannot delete changed league data');
reset role;
select is((select count(*)::integer from public.leagues where id = current_setting('test.league_id')::uuid), 1,
  'rejected deletion leaves the league intact');
select is((select count(*)::integer from public.roster_slot_history
  where roster_entry_id = '95000000-0000-4000-8000-000000000013'), 1,
  'rejected deletion leaves restrictive histories intact');
set local role authenticated;
select lives_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  'League commands fixture', 1, 'league-delete-qa-01')$$,
  'the confirmed commissioner can delete an active league with histories');
select lives_ok($$select public.delete_league(current_setting('test.league_id')::uuid,
  'League commands fixture', 1, 'league-delete-qa-01')$$,
  'a deletion retry succeeds using its committed response');
reset role;
select is((select count(*)::integer from public.leagues where id = current_setting('test.league_id')::uuid), 0,
  'the league is removed');
select is((select count(*)::integer from public.fantasy_teams where league_id = current_setting('test.league_id')::uuid), 0,
  'all manager teams are removed');
select is((select count(*)::integer from public.league_members where league_id = current_setting('test.league_id')::uuid), 0,
  'all memberships are removed');
select is((select count(*)::integer from public.roster_entries where league_id = current_setting('test.league_id')::uuid), 0,
  'rosters are removed');
select is((select count(*)::integer from public.roster_slot_history where roster_entry_id = '95000000-0000-4000-8000-000000000013'), 0,
  'roster histories are removed before their restrictive references');
select is((select count(*)::integer from public.period_lineup_locks where league_id = current_setting('test.league_id')::uuid), 0,
  'lineup locks are removed');
select is((select count(*)::integer from public.trade_votes where trade_id = '95000000-0000-4000-8000-000000000014'), 0,
  'trade votes are removed');
select is((select count(*)::integer from public.trade_items where trade_id = '95000000-0000-4000-8000-000000000014'), 0,
  'trade items are removed');
select is((select count(*)::integer from public.matchups where league_id = current_setting('test.league_id')::uuid), 0,
  'matchups and their winner references are removed');
select is((select count(*)::integer from public.draft_picks where draft_id = '95000000-0000-4000-8000-000000000015'), 0,
  'draft picks are removed');
select is((select count(*)::integer from public.chat_messages where league_id = current_setting('test.league_id')::uuid), 0,
  'league chat is removed');
select is((select count(*)::integer from public.audit_log where action = 'league.deleted'
  and request_id = 'league-delete-qa-01'), 1, 'deletion retains exactly one audit event');
select is((select before_state->>'name' from public.audit_log where action = 'league.deleted'
  and request_id = 'league-delete-qa-01'), 'League commands fixture', 'the deletion audit retains the league identity');
select is((select count(*)::integer from public.leagues where name = 'Unrelated surviving league'), 1,
  'deletion leaves other leagues untouched');
select is((select count(*)::integer from public.athletes where id = '95000000-0000-4000-8000-000000000012'), 1,
  'deletion preserves the shared player directory');
set local role authenticated;
select throws_ok($$select public.delete_league('95000000-0000-4000-8000-000000000999',
  'Unrelated surviving league', 1, 'league-delete-qa-01')$$,
  '22023', 'Idempotency key belongs to another league', 'a cached deletion cannot be reused for another league');
reset role;

select * from finish();
rollback;
