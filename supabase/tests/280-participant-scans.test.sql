begin;
select no_plan();
create function pg_temp.s_id(text) returns uuid language sql immutable as $$select md5('participant-scan-fixture:'||$1)::uuid;$$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.s_id(key),email,now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from (values ('admin','scan-admin@example.test','Scan Admin'),('other-admin','scan-other-admin@example.test','Other Administrator'),
 ('exact','known@example.test','Different Display'),('name','personal@unrelated.test','José OBrien'),('inferred','j.smith23@example.test','Unrelated Display'),
 ('domain','unrelated@example.test','Unrelated Account'),('classified','athlete@example.test','James Smith'),
 ('typo','typo@unrelated.test','Jose OBrin'),('username','known7@otherdomain.test','Other Account'))t(key,email,name);
insert into auth.sessions(id,user_id,aal) select pg_temp.s_id(x),pg_temp.s_id(x),'aal2' from unnest(array['admin','other-admin','exact'])x;
insert into public.user_roles(user_id,role) select pg_temp.s_id(x),'admin' from unnest(array['admin','other-admin'])x;
update beta_private.account_participation set role='athlete',programs=array['mens_hockey'],revision=revision+1 where user_id=pg_temp.s_id('classified');
create temp table reference_fixture as select jsonb_build_object('seasonId','b0000000-0000-4000-8000-000000000002',
 'sources',(select jsonb_agg(jsonb_build_object('file','source-'||n,'sourceHash','hash-'||n))from generate_series(1,12)n),
 'references',jsonb_build_array(
  jsonb_build_object('id',pg_temp.s_id('ref-email'),'name','Exact Reference','emails',jsonb_build_array('known@example.test'),'role','coach','programs',jsonb_build_array('mens_hockey','womens_hockey'),'sources',jsonb_build_array(jsonb_build_object('title','Coach','key','email'))),
  jsonb_build_object('id',pg_temp.s_id('ref-name'),'name','Jose OBrien','emails','[]'::jsonb,'role','athlete','programs',jsonb_build_array('mens_basketball'),'sources','[]'::jsonb),
  jsonb_build_object('id',pg_temp.s_id('ref-inferred'),'name','James Smith','emails','[]'::jsonb,'role','coach','programs',jsonb_build_array('womens_volleyball'),'sources','[]'::jsonb)
 ))::text document;
select lives_ok($$select beta_private.publish_participant_references(document,pg_temp.s_id('admin'),encode(extensions.digest(document,'sha256'),'hex'))from reference_fixture$$,'validated reference version publishes');
select lives_ok($$select beta_private.publish_participant_references(document,pg_temp.s_id('admin'),encode(extensions.digest(document,'sha256'),'hex'))from reference_fixture$$,'reference import retry is idempotent');
select is((select count(*)from beta_private.participant_reference_versions),1::bigint,'one reference version after retry');
select throws_ok($$select beta_private.publish_participant_references(document,pg_temp.s_id('admin'),'wrong')from reference_fixture$$,'PT409','Reference preview hash changed','changed preview is rejected');
select ok(not (select enabled from beta_private.participant_scan_settings),'scans install disabled');
select ok(not has_function_privilege('anon','public.admin_get_participant_scan(uuid)','execute'),'anonymous roles cannot read scans');
select ok(not has_function_privilege('authenticated','beta_private.publish_participant_references(text,uuid,text)','execute'),'clients cannot publish references');
select ok(not exists(select 1 from pg_tables where schemaname='beta_private' and tablename like 'participant_%' and not rowsecurity),'all scan tables enable RLS');
select set_config('request.jwt.claim.sub',pg_temp.s_id('exact')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s_id('exact'),'role','authenticated','aal','aal2','session_id',pg_temp.s_id('exact'))::text,true);
set local role authenticated;
select throws_ok($$select public.admin_list_varsity_participants()$$,'42501','Administrator MFA required','members cannot read private participant accounts');
select throws_ok($$select * from beta_private.participant_scan_matches$$,'42501',null,'members cannot read raw scan rows');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.s_id('admin')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s_id('admin'),'role','authenticated','aal','aal1','session_id',pg_temp.s_id('admin'))::text,true);
set local role authenticated;
select throws_ok($$select public.admin_get_participant_scan()$$,'42501','Administrator MFA required','admin without MFA is denied');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s_id('admin'),'role','authenticated','aal','aal2','session_id',pg_temp.s_id('admin'))::text,true);
set local role authenticated;
select throws_ok($$select public.admin_run_participant_scan('scan-disabled-key')$$,'PT409','Participant scans are awaiting hosted acceptance','release gate blocks scans');
reset role;
update beta_private.participant_scan_settings set enabled=true;
set local role authenticated;
select lives_ok($$select public.admin_run_participant_scan('first-scan-key')$$,'MFA admin runs a scan');
select lives_ok($$select public.admin_run_participant_scan('first-scan-key')$$,'uncertain scan retry retrieves completed run');
select is(jsonb_array_length(public.admin_list_varsity_participants()),1,'directory contains classified accounts');
select is(public.admin_get_participant(pg_temp.s_id('name'))->>'display_name','José OBrien','profile lookup returns current identity');
reset role;
select is((select count(*)from beta_private.participant_scan_runs),1::bigint,'scan retry never duplicates results');
select is((select score from beta_private.participant_scan_matches where user_id=pg_temp.s_id('exact') and reference_id=pg_temp.s_id('ref-email')),100,'exact email outranks a different display name');
select is((select score from beta_private.participant_scan_matches where user_id=pg_temp.s_id('name') and reference_id=pg_temp.s_id('ref-name')),90,'accent-insensitive exact names score 90');
select is((select score from beta_private.participant_scan_matches where user_id=pg_temp.s_id('inferred') and reference_id=pg_temp.s_id('ref-inferred')),60,'separators and trailing digits yield weaker inferred evidence');
select ok((select score between 35 and 89 from beta_private.participant_scan_matches where user_id=pg_temp.s_id('typo') and reference_id=pg_temp.s_id('ref-name')),'a misspelled name is retained as weaker review evidence');
select is((select score from beta_private.participant_scan_matches where user_id=pg_temp.s_id('username') and reference_id=pg_temp.s_id('ref-email')),80,'supplied usernames are compared without their domains');
select is(beta_private.participant_name('José O''Brien'),beta_private.participant_name('Jose OBrien'),'apostrophe variants normalize consistently');
select is((select count(*)from beta_private.participant_scan_matches where user_id=pg_temp.s_id('classified')),0::bigint,'classified accounts are excluded');
select is((select count(*)from beta_private.participant_scan_matches where user_id=pg_temp.s_id('domain') and reference_id=pg_temp.s_id('ref-email')),0::bigint,'shared email domain alone produces no match');
select is(beta_private.participant_tokens('OBrien Jose'),beta_private.participant_tokens('José OBrien'),'token sorting handles reversed names');
create temp table tested_match as select id from beta_private.participant_scan_matches where user_id=pg_temp.s_id('exact') and reference_id=pg_temp.s_id('ref-email');
grant select on tested_match to authenticated;
set local role authenticated;
select lives_ok($$select public.admin_review_participant_match((select id from tested_match),true,'Confirmed different person',null,'dismiss-first-key')$$,'dismissal saves with an audit reason');
select lives_ok($$select public.admin_run_participant_scan('second-scan-key')$$,'second scan completes');
select ok((select bool_and((x->>'dismissed')::boolean) from jsonb_array_elements(public.admin_get_participant_scan()->'matches')x where x->>'user_id'=pg_temp.s_id('exact')::text and x->>'reference_id'=pg_temp.s_id('ref-email')::text),'unchanged dismissal carries into next scan');
select throws_ok($$select public.admin_review_participant_match((select id from tested_match),false,'Reviewed previous dismissal',null,'stale-review-key')$$,'PT409','Review changed; refresh and retry','stale administrator review cannot overwrite another decision');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.s_id('other-admin')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s_id('other-admin'),'role','authenticated','aal','aal2','session_id',pg_temp.s_id('other-admin'))::text,true);
set local role authenticated;
select is(jsonb_array_length(public.admin_get_participant_scan()->'history'),2,'other administrator sees both saved runs');
select is(public.admin_get_participant_scan()->'run'->>'runner_name','Scan Admin','shared metadata identifies the runner');
reset role;
update public.profiles set display_name='Changed profile evidence' where id=pg_temp.s_id('exact');
set local role authenticated;
select throws_ok($$select public.admin_review_participant_match((select id from tested_match),false,'Account evidence has changed',null,'changed-review-key')$$,'PT409','Matching evidence changed; run a new scan','changed account evidence requires a fresh scan');
reset role;
update public.profiles set deleted_at=clock_timestamp() where id=pg_temp.s_id('exact');
select is((select count(*)from beta_private.participant_scan_matches where user_id=pg_temp.s_id('exact')),0::bigint,'soft deletion removes all account scan evidence');
select is((select count(*)from beta_private.participant_scan_reviews where user_id=pg_temp.s_id('exact')),0::bigint,'soft deletion removes review evidence');
insert into beta_private.participant_scan_reviews(id,user_id,reference_id,account_hash,reference_hash,dismissed,reason,reviewed_at)
 select pg_temp.s_id('retained-dismissal'),m.user_id,m.reference_id,m.account_hash,m.reference_hash,true,'Confirmed unrelated participant',clock_timestamp()-interval '91 days'
 from beta_private.participant_scan_matches m where user_id=pg_temp.s_id('name') and reference_id=pg_temp.s_id('ref-name') limit 1;
update beta_private.participant_scan_runs set completed_at=clock_timestamp()-interval '91 days';
update beta_private.participant_scan_runs set completed_at=clock_timestamp()-interval '90 days' where id=(select id from beta_private.participant_scan_runs order by started_at desc limit 1);
select is(jsonb_array_length(public.admin_get_participant_scan()->'history'),1,'expired history is hidden before bounded disposal finishes');
insert into beta_private.retention_holds(category,record_key,reason,expires_at)
  select 'beta_private.participant_scan_runs',id::text,'Open scan review evidence',clock_timestamp()+interval '1 day' from beta_private.participant_scan_runs order by completed_at limit 1;
select lives_ok($$select beta_private.expire_participant_scans(100)$$,'scan cleanup honors a documented hold');
select is((select count(*)from beta_private.participant_scan_runs),2::bigint,'held scan survives cleanup');
delete from beta_private.retention_holds where category='beta_private.participant_scan_runs';
select lives_ok($$select beta_private.expire_participant_scans(100)$$,'scan cleanup works while general retention remains disabled');
select is((select count(*)from beta_private.participant_scan_runs),1::bigint,'cleanup preserves the latest scan');
select ok(exists(select 1 from beta_private.participant_scan_reviews where id=pg_temp.s_id('retained-dismissal')),'unchanged active dismissal survives the history limit');
update beta_private.participant_references set evidence_hash='changed-reference-evidence' where id=pg_temp.s_id('ref-name');
select lives_ok($$select beta_private.expire_participant_scans(100)$$,'changed reference evidence can expire an obsolete dismissal');
select ok(not exists(select 1 from beta_private.participant_scan_reviews where id=pg_temp.s_id('retained-dismissal')),'obsolete dismissal expires after evidence changes');
select is((select retention_enabled from beta_private.release_controls),false,'scan cleanup never enables broader retention');
select * from finish();
rollback;
