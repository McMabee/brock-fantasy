begin;
select no_plan();
select ok(not has_function_privilege('authenticated','public.admin_beta_testers(text,boolean,text)','EXECUTE'),'tester management is retired');
select ok(not has_function_privilege('anon','public.is_admin_account_email(text)','EXECUTE'),'admin lookup is server-only');
select ok(not has_function_privilege('authenticated','beta_private.before_user_created(jsonb)','EXECUTE'),'only Auth may run the signup hook');
select is(beta_private.before_user_created('{"user":{"email":"stranger@brocku.ca"}}'),'{}'::jsonb,'public signup is independent of app authorization');
delete from beta_private.application_access where email in ('gt22me@brocku.ca','ethan.greatorex1245@gmail.com');
insert into beta_private.application_access(email,reason) values
('gt22me@brocku.ca','Explicit isolated existing Tarik fixture'),('ethan.greatorex1245@gmail.com','Explicit isolated existing Ethan fixture');
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select id,email,now(),now(),jsonb_build_object('display_name',name,'beta_age_eligible',true,
'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from (values ('97000000-0000-4000-8000-000000000001'::uuid,'gt22me@brocku.ca','Tarik'),
('97000000-0000-4000-8000-000000000002'::uuid,'ethan.greatorex1245@gmail.com','Ethan'),
('97000000-0000-4000-8000-000000000009'::uuid,'ordinary@example.test','Ordinary')) fixture(id,email,name);
insert into public.user_roles(user_id,role) values ('97000000-0000-4000-8000-000000000001','admin'),('97000000-0000-4000-8000-000000000002','admin');
insert into auth.sessions(id,user_id,aal) values ('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','aal2');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"97000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is(public.can_use_app(),true,'existing verified admin with live session retains app access');
select is(public.current_user_is_admin(),true,'Tarik retains regular admin access');
select throws_ok($$select public.admin_beta_testers('stranger@example.test',true,'Trying to self approve')$$,'42501',null,'tester management is unavailable even to admins');
reset role;
update beta_private.application_access set revoked_at=now() where email='gt22me@brocku.ca';
set local role authenticated;
select is(public.can_use_app(),true,'legacy tester status no longer controls admin access');
reset role;
delete from public.user_roles where user_id='97000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.can_use_app(),true,'removing staff privileges preserves eligible participant access');
select is(public.current_user_is_admin(),false,'revoked administrator cannot use staff operations');
select throws_ok($$select public.get_beta_lineup('97000000-0000-4000-8000-000000000001')$$,'P0001','Team owner access required','participant cannot read an unowned lineup');
select is((select count(*)::int from public.profiles),1,'participant can read their own profile');
reset role;
insert into public.user_roles(user_id,role) values('97000000-0000-4000-8000-000000000001','admin');
select is((select count(*)::int from public.user_roles where user_id in ('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002') and role='admin'),2,'both regular admin roles are preserved without tester dependency');
update beta_private.application_access set revoked_at=null where email='gt22me@brocku.ca';
delete from auth.sessions where id='97000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.can_use_app(),false,'logged-out JWT is denied despite approval');
reset role;
insert into auth.sessions(id,user_id,aal) values('97000000-0000-4000-8000-000000000009','97000000-0000-4000-8000-000000000009','aal2');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000009',true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000009","role":"authenticated","aal":"aal2","session_id":"97000000-0000-4000-8000-000000000009","user_metadata":{"admin":true,"beta_tester":true}}',true);
set local role authenticated;
select is(public.can_use_app(),true,'verified eligible participant with live session receives gameplay access');
select is(public.current_user_is_admin(),false,'editable administrator metadata grants no staff privileges');
select is((select count(*)::int from public.profiles),1,'participant reads only their own profile');
select throws_ok($$select public.get_beta_lineup('97000000-0000-4000-8000-000000000009')$$,'P0001','Team owner access required','ordinary participant cannot bypass lineup ownership');
select throws_ok($$insert into public.user_roles(user_id,role) values('97000000-0000-4000-8000-000000000009','admin')$$,'42501',null,'self-granted admin roles are denied');
reset role;
update public.profiles set deleted_at=now() where id='97000000-0000-4000-8000-000000000009';
set local role authenticated;
select is(public.can_use_app(),false,'deleted account is denied despite a live session');
reset role;
update public.profiles set deleted_at=null where id='97000000-0000-4000-8000-000000000009';
update auth.users set email_confirmed_at=null where id='97000000-0000-4000-8000-000000000009';
set local role authenticated;
select is(public.can_use_app(),false,'unverified participant is denied');
reset role;
update auth.users set email_confirmed_at=now() where id='97000000-0000-4000-8000-000000000009';
delete from beta_private.account_eligibility_attestations where user_id='97000000-0000-4000-8000-000000000009';
set local role authenticated;
select is(public.can_use_app(),false,'editable eligibility metadata cannot replace trusted attestation');
select throws_ok($$select public.record_account_eligibility(false,'brock-beta-eligibility-2026-10-06.1')$$,
  '22023','Confirm that you are 18 or turn 18 this calendar year','an unchecked confirmation cannot create eligibility');
select is(public.record_account_eligibility(true,'brock-beta-eligibility-2026-10-06.1'),true,'legacy account can personally record eligibility');
select is(public.can_use_app(),true,'explicit confirmation enables ordinary gameplay');
select is(public.current_user_is_admin(),false,'confirming eligibility never grants staff access');
select is(public.record_account_eligibility(true,'brock-beta-eligibility-2026-10-06.1'),true,'repeated eligibility confirmation is idempotent');
reset role;
select * from finish();
rollback;
