begin;
select no_plan();

select is((
  select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'rpc_private'
), 37, 'all 37 reported signatures have private implementations');
select is((
  select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
), 0, 'no API-exposed definer is executable by anonymous or signed-in users');

select ok(
  not exposed.prosecdef and private.prosecdef
  and pg_get_function_arguments(exposed.oid) = pg_get_function_arguments(private.oid)
  and pg_get_function_result(exposed.oid) = pg_get_function_result(private.oid)
  and exposed.provolatile = private.provolatile
  and exposed.proisstrict = private.proisstrict
  and exposed.proparallel = private.proparallel
  and exposed.proconfig = private.proconfig,
  'invoker preserves arguments, defaults, result and execution attributes: ' || exposed.oid::regprocedure::text
)
from pg_proc private join pg_namespace n on n.oid = private.pronamespace
join pg_proc exposed on exposed.pronamespace = 'public'::regnamespace
  and exposed.proname = private.proname and exposed.proargtypes = private.proargtypes
where n.nspname = 'rpc_private' order by exposed.oid::regprocedure::text;

select ok(
  not has_function_privilege('anon', exposed.oid, 'EXECUTE')
  and has_function_privilege('authenticated', exposed.oid, 'EXECUTE')
  and has_function_privilege('authenticated', private.oid, 'EXECUTE')
  and has_function_privilege('service_role', exposed.oid, 'EXECUTE')
    = has_function_privilege('service_role', private.oid, 'EXECUTE')
  and not exists (
    select 1 from aclexplode(private.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'explicit client grants preserve the trusted boundary: ' || exposed.oid::regprocedure::text
)
from pg_proc private join pg_namespace n on n.oid = private.pronamespace
join pg_proc exposed on exposed.pronamespace = 'public'::regnamespace
  and exposed.proname = private.proname and exposed.proargtypes = private.proargtypes
where n.nspname = 'rpc_private' order by exposed.oid::regprocedure::text;

select is((
  select count(*)::integer from pg_proc p where p.pronamespace = 'rpc_private'::regnamespace
    and has_function_privilege('anon', p.oid, 'EXECUTE')
), 1, 'anonymous SQL policies can execute only the private admin predicate');
select ok(not has_schema_privilege('anon', 'beta_private', 'USAGE'), 'anonymous policy reads do not expose beta internals');
select ok(not has_schema_privilege('anon', 'rpc_private', 'CREATE')
  and not has_schema_privilege('authenticated', 'rpc_private', 'CREATE')
  and not has_schema_privilege('service_role', 'rpc_private', 'CREATE'), 'API roles cannot replace private implementations');
select ok(has_function_privilege('service_role', 'public.make_draft_pick(uuid,uuid,text,public.draft_pick_source)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.make_draft_pick(uuid,uuid,text,public.draft_pick_source,bigint)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.replay_game(uuid,text)', 'EXECUTE'), 'draft worker overloads and scoring replay retain service access');
select ok(not has_function_privilege('authenticated', 'public.consume_rate_limit(text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.process_expired_drafts(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.legacy_start_draft(uuid,integer,integer,text)', 'EXECUTE'), 'service and internal commands retain client denial');
select ok(exists (
  select 1 from pg_policy policy join pg_depend dependency
    on dependency.classid = 'pg_policy'::regclass and dependency.objid = policy.oid
  where policy.polname = 'active_competitions_public_read'
    and dependency.refobjid = 'rpc_private.current_user_is_admin()'::regprocedure
), 'anonymous policy dependency follows the original function OID');

-- All fixtures and commands roll back. Exercise actual API roles, not postgres.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select id, email, now(), jsonb_build_object('display_name', 'RPC test user', 'beta_age_eligible', true,
  'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
  'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now()
from (values
  ('99000000-0000-4000-8000-000000000001'::uuid, 'rpc-member@example.test'),
  ('99000000-0000-4000-8000-000000000002'::uuid, 'rpc-other@example.test')
) as fixture(id, email);
insert into public.user_roles (user_id, role)
values ('99000000-0000-4000-8000-000000000001', 'admin');
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
insert into public.drafts (id, league_id, status, rounds, pick_seconds, league_size, is_test)
values ('99000000-0000-4000-8000-000000000013', '99000000-0000-4000-8000-000000000006', 'complete', 1, 90, 4, false),
       ('99000000-0000-4000-8000-000000000014', '99000000-0000-4000-8000-000000000008', 'complete', 1, 90, 6, false);
insert into public.draft_picks (draft_id, fantasy_team_id, athlete_id, overall_pick, round, pick_in_round, source)
values ('99000000-0000-4000-8000-000000000013', '99000000-0000-4000-8000-000000000011', '99000000-0000-4000-8000-000000000010', 1, 1, 1, 'manager'),
       ('99000000-0000-4000-8000-000000000014', '99000000-0000-4000-8000-000000000012', '99000000-0000-4000-8000-000000000010', 3, 1, 3, 'autopick');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select public.current_user_is_admin()$$, '42501', null, 'anonymous public admin RPC is denied');
select is(rpc_private.current_user_is_admin(), false, 'anonymous private policy predicate returns false');
select is((select count(*)::integer from public.competitions where id = '99000000-0000-4000-8000-000000000005'),
  1, 'anonymous active competition SELECT policy still works');
select throws_ok($$select rpc_private.register_push_token('ExpoPushToken[test_rpc]', 'ios')$$,
  '42501', null, 'anonymous users cannot invoke a private mutation');
reset role;

select set_config('request.jwt.claim.sub', '99000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.current_user_is_admin(), false, 'AAL1 admin remains unauthorized');
select is(public.is_league_member('99000000-0000-4000-8000-000000000006'), true, 'membership helper avoids RLS recursion');
select lives_ok($$select public.get_league_standings('99000000-0000-4000-8000-000000000006')$$,
  'table-returning standings wrapper accepts league members');
select lives_ok($$select public.register_push_token('ExpoPushToken[test_rpc]', 'ios')$$,
  'authenticated push registration works through invoker wrapper');
select lives_ok($$select public.disable_push_token('ExpoPushToken[test_rpc]')$$,
  'void-returning wrapper executes the owned update');
select is((select enabled from public.push_tokens where expo_push_token = 'ExpoPushToken[test_rpc]'),
  false, 'push token was disabled by its owner');
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select is(public.current_user_is_admin(), true, 'AAL2 admin remains authorized through invoker wrapper');
reset role;
update public.push_tokens set enabled = true where expo_push_token = 'ExpoPushToken[test_rpc]';

select set_config('request.jwt.claim.sub', '99000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","user_metadata":{"admin":true}}', true);
set local role authenticated;
select is(public.current_user_is_admin(), false, 'editable metadata cannot grant admin access');
select is((select count(*)::integer from public.leagues where id = '99000000-0000-4000-8000-000000000006'),
  0, 'non-members still cannot read the private league');
select is(public.get_athlete_adp('99000000-0000-4000-8000-000000000010', '99000000-0000-4000-8000-000000000007'),
  '{"average":2,"samples":2,"autopicks":1}'::jsonb, 'ADP default argument retains global cross-league aggregate');
select is(public.get_athlete_adp('99000000-0000-4000-8000-000000000010', '99000000-0000-4000-8000-000000000007', 4),
  '{"average":1,"samples":1,"autopicks":0}'::jsonb, 'ADP explicit league size filter is preserved');
select throws_ok($$select public.get_league_standings('99000000-0000-4000-8000-000000000006')$$,
  'League membership required', 'standings wrapper retains cross-league denial');
select throws_ok($$select public.admin_adjust_score(null, null, null, 1, 'Test denial reason', 'rpc-admin-denied')$$,
  'Administrator access required', 'ordinary signed-in users cannot adjust scores');
select lives_ok($$select public.disable_push_token('ExpoPushToken[test_rpc]')$$,
  'another user cannot update the owned push token');
reset role;
select is((select enabled from public.push_tokens where expo_push_token = 'ExpoPushToken[test_rpc]'),
  true, 'another user leaves the owner token enabled');

select * from finish();
rollback;
