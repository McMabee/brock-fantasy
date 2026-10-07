begin;
select plan(12);

select has_table('beta_private', 'account_eligibility_attestations', 'attestation evidence is stored privately');
select ok((select relrowsecurity from pg_class where oid = 'beta_private.account_eligibility_attestations'::regclass), 'private attestation table has RLS');
select ok(not has_table_privilege('anon', 'beta_private.account_eligibility_attestations', 'INSERT'), 'anonymous callers cannot write attestations');
select ok(not has_table_privilege('authenticated', 'beta_private.account_eligibility_attestations', 'UPDATE'), 'members cannot rewrite recorded attestations');

select lives_ok($test$
  insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
  values('99000000-0000-4000-8000-000000000001', 'eligibility@example.test',
    jsonb_build_object('display_name', 'Eligibility test', 'beta_age_eligible', true,
      'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
      'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now());
$test$, 'valid calendar-year attestation creates a profile');

select is((select registration_year from beta_private.account_eligibility_attestations where user_id = '99000000-0000-4000-8000-000000000001'), extract(year from timezone('America/Toronto', now()))::integer, 'registration year uses Toronto time');

select throws_ok($test$
  insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
  values('99000000-0000-4000-8000-000000000002', 'missing@example.test', '{}', now(), now());
$test$, '22023', 'Calendar-year eligibility attestation required', 'direct signup without attestation is rejected');
select throws_ok($test$
  insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
  values('99000000-0000-4000-8000-000000000003', 'false@example.test',
    jsonb_build_object('beta_age_eligible', false, 'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
      'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now());
$test$, '22023', 'Calendar-year eligibility attestation required', 'false eligibility attestation is rejected');
select throws_ok($test$
  insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
  values('99000000-0000-4000-8000-000000000004', 'stale@example.test',
    jsonb_build_object('beta_age_eligible', true, 'beta_eligibility_year', 2025,
      'beta_eligibility_policy_version', 'brock-beta-eligibility-2026-10-06.1'), now(), now());
$test$, '22023', 'Calendar-year eligibility attestation required', 'stale registration-year assertion is rejected');
select throws_ok($test$
  insert into auth.users(id, email, raw_user_meta_data, created_at, updated_at)
  values('99000000-0000-4000-8000-000000000005', 'version@example.test',
    jsonb_build_object('beta_age_eligible', true, 'beta_eligibility_year', extract(year from timezone('America/Toronto', now()))::integer,
      'beta_eligibility_policy_version', 'old-version'), now(), now());
$test$, '22023', 'Calendar-year eligibility attestation required', 'unrecognized policy version is rejected');

update auth.users set raw_user_meta_data = '{}' where id = '99000000-0000-4000-8000-000000000001';
select is((select policy_version from beta_private.account_eligibility_attestations where user_id = '99000000-0000-4000-8000-000000000001'), 'brock-beta-eligibility-2026-10-06.1', 'later metadata edits cannot rewrite trusted original evidence');
delete from auth.users where id = '99000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from beta_private.account_eligibility_attestations where user_id = '99000000-0000-4000-8000-000000000001'), 0, 'account deletion cascades to the minimal eligibility record');

select * from finish();
rollback;
