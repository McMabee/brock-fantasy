begin;
select plan(22);
select ok((select relrowsecurity from pg_class where oid='beta_private.admin_role_managers'::regclass),'operator capability table has RLS');
select ok(not has_table_privilege('authenticated','beta_private.admin_role_managers','SELECT'),'members cannot read the capability table');
select ok(not has_function_privilege('anon','public.admin_set_account_role(uuid,boolean,text,text)','EXECUTE'),'anonymous role changes denied');
select ok(not (select prosecdef from pg_proc where oid='public.admin_set_account_role(uuid,boolean,text,text)'::regprocedure),'public wrapper uses invoker permissions');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
select id,email,now(),jsonb_build_object('display_name',name,'beta_age_eligible',true,
  'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::integer,
  'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'),now(),now()
from (values
  ('98000000-0000-4000-8000-000000000001'::uuid,'operator@example.test','Operator'),
  ('98000000-0000-4000-8000-000000000002'::uuid,'staff@example.test','Staff')
) as fixture(id,email,name);
insert into public.user_roles(user_id,role) values('98000000-0000-4000-8000-000000000001','admin');
insert into beta_private.admin_role_managers(user_id) values('98000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,aal) values
  ('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000001','aal2'),
  ('98000000-0000-4000-8000-000000000012','98000000-0000-4000-8000-000000000002','aal2');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"98000000-0000-4000-8000-000000000011"}',true);
set local role authenticated;
select is(public.can_manage_admin_accounts(),false,'operator AAL1 cannot manage staff');
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','admin-aal1-denied')$$,'42501','Operator MFA access required','AAL1 mutation denied');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000011"}',true);
select is(public.can_manage_admin_accounts(),true,'operator AAL2 can manage staff');
select is(public.admin_find_account(' STAFF@example.test ')->>'id','98000000-0000-4000-8000-000000000002','exact case-insensitive lookup finds verified profile');
select is(public.admin_find_account('unknown@example.test')->>'found','false','unknown lookup does not fabricate an account');
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','admin-totp-denied')$$,'22023','Verified email, eligibility and enrolled TOTP required','grant requires target TOTP');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)
values('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000002','totp','verified','disposable-fixture-only',now(),now());
delete from beta_private.account_eligibility_attestations where user_id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','admin-eligibility-denied')$$,'22023','Verified email, eligibility and enrolled TOTP required','grant requires recorded eligibility');
reset role;
insert into beta_private.account_eligibility_attestations(user_id,registration_year,policy_version,attested_at)
values('98000000-0000-4000-8000-000000000002',extract(year from timezone('America/Toronto',now()))::integer,'brock-beta-eligibility-2026-10-06.1',now());
update auth.users set email_confirmed_at=null where id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','admin-email-denied')$$,'22023','Verified email, eligibility and enrolled TOTP required','grant requires verified email');
reset role;
update auth.users set email_confirmed_at=now() where id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','admin-grant-success')$$,'ready staff grant succeeds');
select ok(exists(select 1 from public.user_roles where user_id='98000000-0000-4000-8000-000000000002' and role='admin'),'grant persisted');
select lives_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','admin-grant-success')$$,'same request retry succeeds');
select is((select count(*)::integer from public.audit_log where request_id='admin-grant-success'),1,'retry retains one audit event');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000012"}',true);
select is(public.can_manage_admin_accounts(),false,'staff admin role does not confer role-manager capability');
select throws_ok($$select public.admin_find_account('operator@example.test')$$,'42501','Operator MFA access required','staff cannot inspect other accounts');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000011"}',true);
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000001',false,'Disable operator','admin-self-denied')$$,'42501','Protected operator access cannot be revoked here','operator cannot revoke own protected access');
select lives_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',false,'Staff access withdrawn','admin-revoke-success')$$,'operator revokes staff access');
select ok(not exists(select 1 from public.user_roles where user_id='98000000-0000-4000-8000-000000000002' and role='admin'),'revoke persisted');
reset role;
delete from auth.sessions where id='98000000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok($$select public.can_manage_admin_accounts()$$,'42501','Session has been revoked','stale authenticated operator session denied');
select * from finish();
rollback;
