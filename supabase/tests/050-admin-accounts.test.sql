begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='beta_private.admin_invitations'::regclass),'invitations have RLS');
select ok(not has_table_privilege('authenticated','beta_private.admin_invitations','SELECT'),'members cannot read invitations');
select ok(not has_function_privilege('anon','public.admin_create_invitation(text,text,text)','EXECUTE'),'anonymous invitations denied');
select ok(not has_function_privilege('anon','public.admin_accept_invitation(uuid)','EXECUTE'),'anonymous acceptance denied');
select ok(not (select prosecdef from pg_proc where oid='public.admin_accept_invitation(uuid)'::regprocedure),'public wrapper is invoker');
delete from beta_private.admin_role_managers;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
select id,email,now(),jsonb_build_object('display_name',name,'beta_age_eligible',true,
  'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::integer,
  'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1','super_admin',true),now(),now()
from (values
  ('98000000-0000-4000-8000-000000000001'::uuid,'tymabee@proton.me','Ty Mabee'),
  ('98000000-0000-4000-8000-000000000002'::uuid,'staff@example.test','Staff'),
  ('98000000-0000-4000-8000-000000000003'::uuid,'other@example.test','Other Admin')
) as fixture(id,email,name);
insert into public.user_roles(user_id,role) values
  ('98000000-0000-4000-8000-000000000001','admin'),('98000000-0000-4000-8000-000000000003','admin');
insert into beta_private.admin_role_managers(user_id) values('98000000-0000-4000-8000-000000000001');
select throws_ok($$insert into beta_private.admin_role_managers(user_id) values('98000000-0000-4000-8000-000000000003')$$,
  '23505',null,'a second super administrator cannot be configured');
insert into auth.sessions(id,user_id,aal) values
  ('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000001','aal2'),
  ('98000000-0000-4000-8000-000000000012','98000000-0000-4000-8000-000000000002','aal2'),
  ('98000000-0000-4000-8000-000000000013','98000000-0000-4000-8000-000000000003','aal2');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"98000000-0000-4000-8000-000000000011"}',true);
set local role authenticated;
select is(public.can_manage_admin_accounts(),false,'Ty AAL1 cannot manage staff');
select throws_ok($$select public.admin_create_invitation('staff@example.test','Staff onboarding','invite-aal1-denied')$$,
  '42501','Super administrator MFA access required','AAL1 invitation denied');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000011"}',true);
select is(public.can_manage_admin_accounts(),true,'named Ty with AAL2 can invite');
select is(public.admin_find_account(' STAFF@example.test ')->>'id','98000000-0000-4000-8000-000000000002','case-insensitive email lookup');
select is(public.admin_find_account('unknown@example.test')->>'found','false','unknown lookup cannot fabricate account');
select throws_ok($$select public.admin_create_invitation('unknown@example.test','Staff onboarding','invite-unknown-denied')$$,
  '22023','A registered account with verified email and confirmed eligibility is required','unregistered accounts cannot be invited');
reset role;
update auth.users set email_confirmed_at=null where id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.admin_create_invitation('staff@example.test','Staff onboarding','invite-email-denied')$$,
  '22023','A registered account with verified email and confirmed eligibility is required','unverified recipient cannot be invited');
reset role;
update auth.users set email_confirmed_at=now() where id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select lives_ok($$select set_config('test.invitation',(public.admin_create_invitation(' STAFF@example.test ','Staff onboarding','invite-success')->>'invitationId'),true)$$,
  'Ty invites member before authenticator enrollment');
select ok(not exists(select 1 from public.user_roles where user_id='98000000-0000-4000-8000-000000000002' and role='admin'),'invitation alone does not grant admin');
select is(public.admin_create_invitation('staff@example.test','Staff onboarding','invite-success')->>'invitationId',current_setting('test.invitation'),'creation retry reuses invitation');
select is((select count(*)::integer from public.audit_log where request_id='invite-success'),1,'creation retry retains one audit event');
select throws_ok($$select public.admin_create_invitation('staff@example.test','Staff onboarding','invite-too-soon')$$,
  'P0001','Wait one minute before sending a new invitation','new invitations have a cooldown');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000013","user_metadata":{"super_admin":true}}',true);
select is(public.can_manage_admin_accounts(),false,'admin role and editable metadata cannot confer super admin');
select throws_ok($$select public.admin_create_invitation('staff@example.test','Staff onboarding','other-invite-denied')$$,'42501','Super administrator MFA access required','standard admins cannot invite');
select throws_ok($$select public.admin_find_account('tymabee@proton.me')$$,'42501','Super administrator MFA access required','standard admins cannot inspect accounts');
select throws_ok($$select public.admin_mark_invitation_sent(current_setting('test.invitation')::uuid)$$,'42501','Super administrator MFA access required','standard admins cannot mark email sent');
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501',null,'forwarded invitation cannot be accepted by another account');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"98000000-0000-4000-8000-000000000012"}',true);
select throws_ok($$select public.admin_invitation_status(current_setting('test.invitation')::uuid)$$,'42501',null,'email failure leaves invitation unclaimable');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000011"}',true);
select lives_ok($$select public.admin_mark_invitation_sent(current_setting('test.invitation')::uuid)$$,'super admin confirms email send');
select is(public.admin_create_invitation('staff@example.test','Staff onboarding','invite-success')->>'alreadySent','true','completed retry avoids another email');
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',true,'Staff onboarding','direct-grant-denied')$$,'42501','Send an admin invitation; direct grants are disabled','Ty cannot bypass recipient acceptance');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","session_id":"98000000-0000-4000-8000-000000000012"}',true);
select is(public.admin_invitation_status(current_setting('test.invitation')::uuid)->>'invitationId',current_setting('test.invitation'),'recipient views own sent invitation at AAL1');
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501','Verify your authenticator and confirm account eligibility before accepting','AAL1 cannot activate admin');
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000012"}',true);
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501','Verify your authenticator and confirm account eligibility before accepting','verified TOTP mandatory');
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)
values('98000000-0000-4000-8000-000000000021','98000000-0000-4000-8000-000000000002','totp','verified','disposable-fixture-only',now(),now());
update auth.users set email='changed@example.test' where id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501',null,'changed recipient email invalidates invitation');
reset role;
update auth.users set email='staff@example.test' where id='98000000-0000-4000-8000-000000000002';
update beta_private.admin_invitations set expires_at=now()-interval '1 second' where id=current_setting('test.invitation')::uuid;
set local role authenticated;
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501',null,'expired invitation cannot grant access');
reset role;
update beta_private.admin_invitations set expires_at=now()+interval '7 days' where id=current_setting('test.invitation')::uuid;
delete from beta_private.account_eligibility_attestations where user_id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501','Verify your authenticator and confirm account eligibility before accepting','eligibility is rechecked on acceptance');
reset role;
insert into beta_private.account_eligibility_attestations(user_id,registration_year,policy_version,attested_at)
values('98000000-0000-4000-8000-000000000002',extract(year from timezone('America/Toronto',now()))::integer,'brock-beta-eligibility-2026-10-06.1',now());
set local role authenticated;
select lives_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'recipient MFA activates admin access');
select ok(exists(select 1 from public.user_roles where user_id='98000000-0000-4000-8000-000000000002' and role='admin'),'accepted grant persisted');
select is((select granted_by::text from public.user_roles where user_id='98000000-0000-4000-8000-000000000002' and role='admin'),'98000000-0000-4000-8000-000000000001','grant attributed to Ty');
select is(public.can_manage_admin_accounts(),false,'new admin cannot invite others');
select is(public.current_user_is_admin(),true,'new admin retains standard operations access');
select lives_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'acceptance retry succeeds');
reset role;
select is((select count(*)::integer from public.audit_log where action='admin.invitation_accepted' and entity_id='98000000-0000-4000-8000-000000000002'),1,'acceptance retry retains one audit event');
update auth.users set email='renamed@example.test' where id='98000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_invitation_status(current_setting('test.invitation')::uuid)$$,'42501',null,'changed super admin identity invalidates invitations');
reset role;
update auth.users set email='tymabee@proton.me' where id='98000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000011"}',true);
select throws_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000001',false,'Disable operator','admin-self-denied')$$,'42501','Protected super administrator access cannot be revoked here','Ty cannot revoke own protected role');
select lives_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',false,'Staff access withdrawn','admin-revoke-success')$$,'Ty revokes staff access');
select ok(not exists(select 1 from public.user_roles where user_id='98000000-0000-4000-8000-000000000002' and role='admin'),'revoke persisted');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000012"}',true);
select throws_ok($$select public.admin_accept_invitation(current_setting('test.invitation')::uuid)$$,'42501',null,'old link cannot restore revoked access');
select is(public.current_user_is_admin(),false,'revoked admin loses operations access');
reset role;
update beta_private.admin_invitations set created_at=now()-interval '2 minutes' where user_id='98000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"98000000-0000-4000-8000-000000000011"}',true);
select lives_ok($$select public.admin_create_invitation('staff@example.test','Staff re-onboarding','invite-new')$$,'Ty can re-invite revoked staff');
select lives_ok($$select public.admin_set_account_role('98000000-0000-4000-8000-000000000002',false,'Cancel staff invitation','admin-cancel-success')$$,'Ty cancels outstanding invitation');
select throws_ok($$select public.admin_create_invitation('staff@example.test','Staff re-onboarding','invite-new')$$,'22023','Invitation is unavailable; find the account and send a new invitation','retry cannot resend cancelled invitation');
reset role;
delete from auth.sessions where id='98000000-0000-4000-8000-000000000011';
set local role authenticated;
select throws_ok($$select public.can_manage_admin_accounts()$$,'42501','Session has been revoked','stale super admin session denied');
select * from finish();
rollback;
