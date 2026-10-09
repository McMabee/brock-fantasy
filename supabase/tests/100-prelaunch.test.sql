begin;
select no_plan();
-- Test harness only: the production API role has no extension-schema access.
grant usage on schema extensions to prelaunch_api;
select ok(not has_schema_privilege('anon','registration_private','USAGE'),'enrollment schema is not available to anonymous clients');
select ok(not has_table_privilege('prelaunch_api','public.profiles','SELECT'),'registration credential cannot read fantasy profiles');
select ok(not has_table_privilege('prelaunch_api','auth.users','INSERT'),'registration cannot create Auth accounts');
select ok(not has_table_privilege('prelaunch_api','registration_private.registrations','SELECT'),'API login has routines, not table access');
select set_config('test.auth_count',(select count(*)::text from auth.users),true);
set local role prelaunch_api;
select lives_ok($$select registration_private.enroll('subscriber@example.test','Subscriber','consent-test',
decode(repeat('11',32),'hex'),decode(repeat('22',32),'hex'),decode(repeat('33',32),'hex'),repeat('encrypted',20),true)$$,'restricted login can enroll');
select is(registration_private.receipt_valid(decode(repeat('11',32),'hex')),true,'receipt is valid after commit');
select is(registration_private.receipt_valid(decode(repeat('99',32),'hex')),false,'unknown receipt is denied');
select is(registration_private.token_valid(decode(repeat('22',32),'hex'),'confirm'),true,'confirmation token is pending');
select lives_ok($$select registration_private.enroll('subscriber@example.test',null,'consent-test',
decode(repeat('44',32),'hex'),decode(repeat('55',32),'hex'),decode(repeat('66',32),'hex'),repeat('encrypted',20),false)$$,'duplicate enrollment is successful without duplicate email delivery');
reset role;
select is((select count(*)::int from registration_private.registrations where email='subscriber@example.test'),1,'normalized email uniqueness is enforced');
select is((select count(*)::text from auth.users),current_setting('test.auth_count'),'public enrollment creates no Auth identity');
select is((select state from registration_private.registrations where email='subscriber@example.test'),'pending','consent remains pending before owner confirmation');
set local role prelaunch_api;
select is(registration_private.apply_email_token(decode(repeat('22',32),'hex'),'confirm'),true,'explicit confirmation subscribes');
select is(registration_private.apply_email_token(decode(repeat('22',32),'hex'),'confirm'),false,'confirmation token is single-use');
select is(registration_private.apply_email_token(decode(repeat('33',32),'hex'),'unsubscribe'),true,'unsubscribe works without an account');
select lives_ok($$select registration_private.enroll('subscriber@example.test',null,'consent-test',
decode(repeat('77',32),'hex'),decode(repeat('88',32),'hex'),decode(repeat('aa',32),'hex'),repeat('encrypted',20),true)$$,'fresh owner confirmation can be requested after withdrawal');
reset role;
select is((select state from registration_private.registrations where email='subscriber@example.test'),'unsubscribed','duplicate submission cannot silently undo withdrawal');
update registration_private.signup_receipts set expires_at=now()-interval '1 second';
set local role prelaunch_api;
select is(registration_private.receipt_valid(decode(repeat('11',32),'hex')),false,'expired receipt is denied');
reset role;
update beta_private.launch_state set phase='public',launched_at=now();
set local role prelaunch_api;
select is(registration_private.development_open(),false,'launch closes development sending');
select is(registration_private.apply_email_token(decode(repeat('88',32),'hex'),'confirm'),false,'launch closes development confirmation');
select throws_ok($$select registration_private.enroll('late@example.test',null,'consent-test',decode(repeat('ab',32),'hex'),decode(repeat('ac',32),'hex'),decode(repeat('ad',32),'hex'),repeat('encrypted',20),true)$$,'P0001','Development enrollment is closed','launch closes intake');
select lives_ok($$select registration_private.maintenance()$$,'restricted maintenance remains operational');
reset role;
select * from finish();
rollback;
