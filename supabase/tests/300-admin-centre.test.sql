begin;
select no_plan();
create function pg_temp.c_id(text) returns uuid language sql immutable as $$select md5('admin-centre:'||$1)::uuid;$$;
create function pg_temp.c_actor(p_name text,p_aal text default 'aal2') returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',pg_temp.c_id(p_name)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.c_id(p_name),'session_id',pg_temp.c_id(p_name),'role','authenticated','aal',p_aal)::text,true);
end;$$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.c_id(name),name||'@example.test',now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from(select unnest(array['admin','admin2','outsider']) name union all select 'candidate'||n from generate_series(1,6)n)x;
insert into auth.sessions(id,user_id,aal) select id,id,'aal2' from auth.users where email like '%@example.test';
insert into public.user_roles(user_id,role) values(pg_temp.c_id('admin'),'admin'),(pg_temp.c_id('admin2'),'admin');
update beta_private.release_controls set service_email_enabled=true,participant_confirmation_enabled=true;
insert into beta_private.participant_reference_versions(id,content_hash,season_id,sources,active)
  values(pg_temp.c_id('references'),'centre-fixture','b0000000-0000-4000-8000-000000000002','[]',true);
insert into beta_private.participant_references(version_id,id,name,role,programs,sources,evidence_hash,normalized_name,sorted_name,usernames,inferred_usernames)
select pg_temp.c_id('references'),pg_temp.c_id('reference'||n),'candidate'||n,'athlete',array['womens_hockey'],'[]','hash'||n,'candidate'||n,'candidate'||n,'{}','{}' from generate_series(1,6)n;
insert into beta_private.participant_scan_runs(id,reference_version_id,scoring_version,weights,completed_at)
  values(pg_temp.c_id('scan'),pg_temp.c_id('references'),'fixture','{}',now());
insert into beta_private.participant_scan_matches(id,scan_id,user_id,reference_id,account_hash,reference_hash,score,evidence)
select pg_temp.c_id('match'||n),pg_temp.c_id('scan'),p.id,pg_temp.c_id('reference'||n),beta_private.participant_account_hash(p.display_name,u.email),'hash'||n,90,
  jsonb_build_object('reference',jsonb_build_object('name',p.display_name,'role','athlete','programs',jsonb_build_array('womens_hockey'),'emails','[]'::jsonb,'sources','[]'::jsonb),'accountName',p.display_name,'accountEmail',u.email,'reasons',jsonb_build_array('Matching name'))
from generate_series(1,6)n join public.profiles p on p.id=pg_temp.c_id('candidate'||n) join auth.users u on u.id=p.id;

select ok(not has_function_privilege('anon','public.admin_get_operations(text,text,text,text,text,text,text,date,date,timestamptz,text,integer)','execute'),'anonymous clients cannot read operations');
select ok(not has_function_privilege('authenticated','beta_private.participant_request_json(beta_private.participant_confirmation_requests,boolean)','execute'),'request JSON helper is private');
select ok(not has_table_privilege('authenticated','beta_private.participant_confirmation_requests','select'),'requests are not directly exposed');
select pg_temp.c_actor('outsider');set local role authenticated;
select throws_ok($$select public.admin_get_operations()$$,'42501','Administrator MFA required','members cannot read operational records');
select throws_ok($$select public.admin_list_participant_requests()$$,'42501','Administrator MFA required','members cannot browse recipient identities');
select throws_ok($$select public.admin_get_ranking_seasons()$$,'42501','Administrator MFA required','members cannot browse admin ranking history');
select throws_ok($$select public.admin_list_leagues_filtered()$$,'42501','Administrator MFA required','members cannot query directory counts');
reset role;select pg_temp.c_actor('admin','aal1');set local role authenticated;
select throws_ok($$select public.admin_request_participant_confirmation(pg_temp.c_id('match1'),'no-mfa-request')$$,'42501','Administrator MFA required','admin email sending requires MFA');
reset role;select pg_temp.c_actor('admin');set local role authenticated;
create temp table requests(n integer primary key,id uuid);
insert into requests select n,(public.admin_request_participant_confirmation(pg_temp.c_id('match'||n),'create-request-'||n)->>'requestId')::uuid from generate_series(1,6)n;
select is((public.admin_request_participant_confirmation(pg_temp.c_id('match1'),'create-request-1')->>'requestId')::uuid,(select id from requests where n=1),'uncertain send retry returns the original request');
select is(jsonb_array_length(public.admin_list_participant_requests()->'items'),6,'all requests are shared with administrators');
select is(public.admin_get_participant_scan(pg_temp.c_id('scan'))->'matches'->0->'confirmation_request'->>'status','pending','scan includes current confirmation status');
reset role;select pg_temp.c_actor('admin2');set local role authenticated;
select throws_ok($$select public.admin_request_participant_confirmation(pg_temp.c_id('match1'),'other-admin-request')$$,'PT429','A confirmation email was already requested for this account in the last 24 hours','resend limit is shared across administrators');
reset role;select pg_temp.c_actor('outsider');set local role authenticated;
select throws_ok($$select public.get_my_participant_request((select id from requests where n=1))$$,'P0002','Confirmation request unavailable for this account','request ID does not grant another account read access');
select throws_ok($$select public.submit_participant_confirmation((select id from requests where n=1),'none','{}','','outsider-response')$$,'P0002','Confirmation request unavailable for this account','wrong account cannot submit a response');
reset role;select pg_temp.c_actor('candidate1','aal1');set local role authenticated;
select is(public.get_my_participant_request((select id from requests where n=1))->>'suggested_role','athlete','recipient receives the suggested role without administrator MFA');
select throws_ok($$select public.submit_participant_confirmation((select id from requests where n=1),'athlete','{}','','invalid-programs')$$,'22023','Select a valid role and its programs','program requirements are validated in the database');
select lives_ok($$select public.submit_participant_confirmation((select id from requests where n=1),'none','{}','This is a different person','candidate1-response')$$,'recipient can answer Neither');
select lives_ok($$select public.submit_participant_confirmation((select id from requests where n=1),'none','{}','This is a different person','candidate1-response')$$,'response retry is idempotent');
select is(public.get_my_participation()->>'role','none','reply alone never changes participation');
reset role;select pg_temp.c_actor('admin');set local role authenticated;
select throws_ok($$select public.admin_review_participant_confirmation((select id from requests where n=1),true,'Reviewed the recipient reply','2000-01-01','stale-review')$$,'PT409','Response or participation changed; reload and review again','stale review versions are rejected');
select lives_ok($$select public.admin_review_participant_confirmation(r.id,true,'Reviewed identity and approved Neither',r.updated_at,'approve-neither') from jsonb_to_recordset(public.admin_list_participant_requests()->'items')r(id uuid,updated_at timestamptz) where r.id=(select id from requests where n=1)$$,'administrator can approve the exact Neither response');
reset role;
select is((select count(*)::int from beta_private.participant_scan_reviews where user_id=pg_temp.c_id('candidate1') and dismissed),1,'Neither approval dismisses only the linked suggestion');
select is((select count(*)::int from beta_private.participant_scan_reviews),1,'other candidate evidence is unaffected');
select is((select status from beta_private.participant_confirmation_requests where id=(select id from requests where n=1)),'approved','approval and dismissal commit together');
select pg_temp.c_actor('candidate2','aal1');set local role authenticated;
select lives_ok($$select public.submit_participant_confirmation((select id from requests where n=2),'coach',array['mens_volleyball'],'Corrected my program','candidate2-response')$$,'recipient can correct role and program');
select is(public.get_my_participation()->>'role','none','corrected reply awaits review');
reset role;select pg_temp.c_actor('admin2');set local role authenticated;
select lives_ok($$select public.admin_review_participant_confirmation(r.id,true,'Confirmed coaching affiliation with recipient',r.updated_at,'approve-coach') from jsonb_to_recordset(public.admin_list_participant_requests()->'items')r(id uuid,updated_at timestamptz) where r.id=(select id from requests where n=2)$$,'another MFA administrator can approve the submitted correction');
reset role;
select is((select role from beta_private.account_participation where user_id=pg_temp.c_id('candidate2')),'coach','approval uses existing participation correction');
select is((select programs from beta_private.account_participation where user_id=pg_temp.c_id('candidate2')),array['mens_volleyball'],'approval applies exactly the submitted programs');
select is((select count(*)::int from beta_private.service_email_jobs where kind='participation'),6,'duplicate send commands create no duplicate email jobs');
update beta_private.participant_confirmation_requests set expires_at=now()-interval '1 minute' where id=(select id from requests where n=3);
select pg_temp.c_actor('candidate3','aal1');set local role authenticated;
select is(public.get_my_participant_request((select id from requests where n=3))->>'status','expired','request expiry is evaluated without waiting for cleanup');
select throws_ok($$select public.submit_participant_confirmation((select id from requests where n=3),'none','{}','','expired-response')$$,'PT409','This request is no longer accepting responses','expired requests reject submission');
reset role;
update auth.users set email='changed-address@example.test' where id=pg_temp.c_id('candidate4');
select is((select status from beta_private.participant_confirmation_requests where id=(select id from requests where n=4)),'obsolete','email changes invalidate outstanding requests');
select pg_temp.c_actor('candidate5','aal1');set local role authenticated;
select public.submit_participant_confirmation((select id from requests where n=5),'athlete',array['womens_hockey'],'','candidate5-response');
reset role;
update beta_private.account_participation set role='coach',programs=array['mens_hockey'],revision=revision+1 where user_id=pg_temp.c_id('candidate5');
select pg_temp.c_actor('admin');set local role authenticated;
select throws_ok($$select public.admin_review_participant_confirmation((select id from requests where n=5),true,'Reviewed response after a concurrent correction',now(),'obsolete-review')$$,'PT409','Response or participation changed; reload and review again','concurrent participation correction prevents stale approval');
reset role;
select is((select role from beta_private.account_participation where user_id=pg_temp.c_id('candidate5')),'coach','failed approval preserves the intervening correction');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
create temp table claimed as select public.claim_service_email_jobs(25) data;
select is((select jsonb_array_length(data) from claimed),1,'worker skips replied, expired, replaced, or obsolete confirmation requests');
select is((select data->0->>'kind' from claimed),'participation','worker returns a typed confirmation email');
select is((select data->0->>'email' from claimed),'candidate6@example.test','worker resolves the recipient server side');
select ok((select public.service_email_sendable((data->0->>'id')::uuid,(data->0->>'leaseToken')::uuid) from claimed),'current recipient-bound email is sendable');
reset role;update beta_private.release_controls set participant_confirmation_enabled=false;set local role service_role;
select ok(not(select public.service_email_sendable((data->0->>'id')::uuid,(data->0->>'leaseToken')::uuid) from claimed),'release rollback stops an already leased confirmation email');
reset role;update beta_private.release_controls set participant_confirmation_enabled=true;set local role service_role;
select public.record_service_email_event('fixture-provider','bounced');
select public.finish_service_email_job((data->0->>'id')::uuid,(data->0->>'leaseToken')::uuid,'accepted','fixture-provider',null) from claimed;
reset role;
select is((select status from beta_private.service_email_jobs where participation_request_id=(select id from requests where n=6)),'bounced','early verified bounce is replayed after provider acceptance');
select ok((select suppressed from beta_private.service_email_preferences where user_id=pg_temp.c_id('candidate6')),'bounce suppresses future service delivery');
select is((select status from beta_private.participant_confirmation_requests where id=(select id from requests where n=6)),'pending','request and email delivery states remain independent');

insert into public.sync_runs(id,provider,started_at,finished_at,status,metadata)
select pg_temp.c_id('run'||n),'Fixture provider',now(),now(),'failed','{"token":"do-not-leak","payload":{"password":"do-not-leak"}}' from generate_series(1,55)n;
insert into public.audit_log(actor_id,action,entity_type,entity_id,before_state,after_state,created_at)
select pg_temp.c_id('admin'),'fixture.account_updated','profile',pg_temp.c_id('candidate2')::text,'{"role":"none","password":"do-not-leak"}','{"role":"coach","token":"do-not-leak"}',now() from generate_series(1,55);
insert into public.audit_log(action,entity_type,entity_id,created_at) values('time.boundary','fixture','boundary','2026-11-02T04:30:00Z');
select pg_temp.c_actor('admin');set local role authenticated;
create temp table audit_page as select public.admin_get_operations('audit',p_query=>'candidate2',p_category=>'fixture') data;
select is(jsonb_array_length((select data->'items' from audit_page)),50,'audit history uses bounded pages');
select ok((select(data->>'hasMore')::boolean from audit_page),'audit history exposes older records');
select is(jsonb_array_length(public.admin_get_operations('audit',p_query=>'candidate2',p_category=>'fixture',p_before_at=>(select(data->'nextCursor'->>'at')::timestamptz from audit_page),p_before_id=>(select data->'nextCursor'->>'id' from audit_page))->'items'),5,'audit cursor handles tied timestamps without gaps');
select ok(strpos((select data::text from audit_page),'do-not-leak')=0,'audit responses exclude secret and raw payload fields');
select is(jsonb_array_length(public.admin_get_operations('audit',p_query=>'Time boundary',p_from=>'2026-11-01',p_to=>'2026-11-01')->'items'),1,'inclusive Toronto dates include late evening across the daylight-saving boundary');
select is(jsonb_array_length(public.admin_get_operations('audit',p_query=>'candidate2',p_category=>'fixture',p_actor=>'admin',p_limit=>1)->'items'),1,'audit actor names and search combine');
select is(jsonb_array_length(public.admin_get_operations_summary()->'auditEvents'),40,'dashboard is limited to 40 audit events');
select ok(public.admin_get_operations('audit',p_query=>'candidate2')->'categories'?'time','audit filter choices include categories outside the current search/page');
select throws_ok($$select public.admin_get_operations(p_from=>'2026-11-02',p_to=>'2026-11-01')$$,'22023','Invalid operations filters','inverted date ranges are rejected');
select is(jsonb_array_length(public.admin_get_operations('runs',p_status=>'failed')->'items'),50,'failed history reaches beyond dashboard runs');
select ok(strpos(public.admin_get_operations('runs')::text,'do-not-leak')=0,'sync metadata cannot expose raw provider secrets');
select throws_ok($$select public.admin_get_operations(p_limit=>1000)$$,'22023','Invalid operations filters','unbounded operations requests are rejected');
reset role;

-- - Verify the retained-history helper preserves index-backed cursor reads
create function pg_temp.c_audit_plan() returns text language plpgsql as $$
declare result json;
begin
  perform set_config('enable_seqscan','off',true);
  execute 'explain(format json) select * from beta_private.operations_audit_rows()
    where (created_at,id)<(''2100-01-01''::timestamptz,9223372036854775807::bigint)
    order by created_at desc,id desc limit 50' into result;
  perform set_config('enable_seqscan','on',true);
  return result::text;
end;$$;
select ok(strpos(pg_temp.c_audit_plan(),'audit_log_admin_cursor')>0
  and strpos(pg_temp.c_audit_plan(),'"Function Scan"')=0,'audit helper allows indexed cursor filtering before bounded entity lookup');

update public.player_pools set is_active=true,rankings_approved_at=now() where id='b0000000-0000-4000-8000-000000000003';
insert into public.fantasy_seasons(id,label,rule_version,status,trade_deadline) values(pg_temp.c_id('past'),'2025-26','fixture','complete',now()),(pg_temp.c_id('future'),'2027-28','fixture','draft',now()+interval '1 year');
insert into public.sports(code,name)values('hockey','Hockey')on conflict(code)do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id)
select pg_temp.c_id(division||'-competition'),id,division::public.division_code,'Fixture '||division,'2026-27','b0000000-0000-4000-8000-000000000004'
from public.sports cross join unnest(array['womens','mens'])division where code='hockey';
insert into public.teams(id,competition_id,name,short_name,is_brock)
select pg_temp.c_id(division||'-team'),pg_temp.c_id(division||'-competition'),'Brock fixture '||division,'BRO',true from unnest(array['womens','mens'])division;
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
select pg_temp.c_id(division||'-athlete'),pg_temp.c_id(division||'-competition'),pg_temp.c_id(division||'-team'),'Fixture '||division,'F','{}' from unnest(array['womens','mens'])division;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select pg_temp.c_id(division||'-athlete'),'b0000000-0000-4000-8000-000000000002',pg_temp.c_id(division||'-competition'),pg_temp.c_id(division||'-team'),array['F'],true,true from unnest(array['womens','mens'])division;
insert into public.pool_competitions(pool_id,competition_id) select 'b0000000-0000-4000-8000-000000000003',pg_temp.c_id(division||'-competition') from unnest(array['womens','mens'])division;
insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,stats,kind)
select pg_temp.c_id(division||'-athlete'),'2026-27','Fixture projection',case when division='womens' then 150 else 100 end,20,'{"goals":15}','supplied_projection' from unnest(array['womens','mens'])division;
insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,stats,kind)
  values(pg_temp.c_id('mens-athlete'),'2025-26','Fixture projection',70,18,'{"25-26 G":12,"availabilityReason":"private source note"}','historical');
select pg_temp.c_actor('admin');set local role authenticated;
select ok(not(public.admin_get_ranking_seasons()->'seasons'?'2027-28'),'future ranking seasons are excluded');
select is(jsonb_array_length(public.admin_get_ranking_review('2025-26')->'rows'),0,'missing historical publication is explicit');
select throws_ok($$select public.admin_get_ranking_review('2025-26',true)$$,'42501','Historical rankings are read only','historical preview cannot enable publication');
create temp table ranking as select public.admin_get_ranking_review('2026-27',true) data;
select is(jsonb_array_length((select data->'rows' from ranking)),2,'current review includes both divisions');
select lives_ok($$select public.admin_publish_preseason_review('b0000000-0000-4000-8000-000000000003',(select data->>'input_hash' from ranking),'Reviewed all supplied input statistics','centre-ranking-publication')$$,'current reviewed snapshot can be published');
reset role;
select is((select display_data->'stats'->>'goals' from public.preseason_ranking_entries order by projected_points desc limit 1),'15','publication captures supporting ranking statistics');
select is((select display_data->'supporting_statistics'->>'season_label' from public.preseason_ranking_entries where athlete_id=pg_temp.c_id('mens-athlete')),'2025-26','same-source prior-season inputs retain their own season label');
select is((select display_data->'supporting_statistics'->'stats'->>'25-26 G' from public.preseason_ranking_entries where athlete_id=pg_temp.c_id('mens-athlete')),'12','CSV-style source statistic headings are preserved');
select ok(not(select display_data->'supporting_statistics'->'stats'?'availabilityReason' from public.preseason_ranking_entries where athlete_id=pg_temp.c_id('mens-athlete')),'free-form source notes are excluded from supporting statistics');
update public.athlete_season_summaries set stats='{"goals":99}' where athlete_id=pg_temp.c_id('womens-athlete');
select is((select display_data->'stats'->>'goals' from public.preseason_ranking_entries order by projected_points desc limit 1),'15','later stats edits do not rewrite the published snapshot');
select pg_temp.c_actor('admin');set local role authenticated;
select throws_ok($$select public.admin_publish_preseason_review('b0000000-0000-4000-8000-000000000003',(select data->>'input_hash' from ranking),'Reviewed all supplied input statistics','centre-stale-ranking')$$,'PT409','Ranking inputs changed; preview and review again','supporting statistic changes invalidate the preview');
reset role;
update public.athletes set fantasy_withdrawn_at=now() where id=pg_temp.c_id('womens-athlete');
select pg_temp.c_actor('admin');set local role authenticated;
select is(jsonb_array_length(public.admin_get_ranking_review('2026-27')->'rows'),1,'historical snapshots preserve athlete withdrawal protections');
reset role;
update public.profiles set deleted_at=now() where id=pg_temp.c_id('candidate5');
select is((select count(*)::int from beta_private.participant_confirmation_requests where user_id=pg_temp.c_id('candidate5')),0,'soft account deletion clears private replies');
delete from auth.users where id=pg_temp.c_id('candidate4');
select is((select count(*)::int from beta_private.service_email_jobs where participation_request_id=(select id from requests where n=4)),0,'hard account deletion clears confirmation delivery records');
select pg_temp.c_actor('candidate6','aal1');set local role authenticated;
select public.submit_participant_confirmation((select id from requests where n=6),'none','{}','','candidate6-response');
reset role;select pg_temp.c_actor('admin');set local role authenticated;
select public.admin_review_participant_confirmation(r.id,false,'Rejected after verifying the affiliation',r.updated_at,'reject-six')
  from jsonb_to_recordset(public.admin_list_participant_requests()->'items')r(id uuid,updated_at timestamptz) where r.id=(select id from requests where n=6);
reset role;
select is((select revision from beta_private.account_participation where user_id=pg_temp.c_id('candidate6')),1::bigint,'rejection never alters the recipient participation revision');
select is((select status from beta_private.participant_confirmation_requests where id=(select id from requests where n=6)),'rejected','rejection is retained separately from the submitted answer');
update beta_private.participant_confirmation_requests set created_at=now()-interval '25 hours' where id=(select id from requests where n=3);
select pg_temp.c_actor('admin');set local role authenticated;
select public.admin_request_participant_confirmation(pg_temp.c_id('match3'),'replacement-after-cooldown');
reset role;
select is((select status from beta_private.participant_confirmation_requests where id=(select id from requests where n=3)),'superseded','manual replacement retires the expired original request');
select is((select count(*)::int from beta_private.participant_confirmation_requests where user_id=pg_temp.c_id('candidate3')and status='pending'),1,'replacement leaves exactly one pending request');
update beta_private.participant_confirmation_requests set updated_at=now()-interval '91 days' where user_id=pg_temp.c_id('candidate3');
insert into beta_private.retention_holds(category,record_key,reason,expires_at) values('beta_private.participant_confirmation_requests',(select id::text from requests where n=3),'Retain this reviewed fixture evidence',now()+interval '1 day');
select ok(beta_private.expire_participant_requests(100)>0,'independent bounded cleanup expires old request evidence');
select is((select count(*)::int from beta_private.participant_confirmation_requests where id=(select id from requests where n=3)),1,'scoped retention hold preserves request evidence and its delivery records');
delete from beta_private.retention_holds where category='beta_private.participant_confirmation_requests';
select beta_private.expire_participant_requests(100);
select is((select count(*)::int from beta_private.participant_confirmation_requests where user_id=pg_temp.c_id('candidate3')),0,'request cleanup removes expired personal evidence');
insert into public.player_pools(id,season_id,name,ruleset_id,is_active) values(pg_temp.c_id('past-pool'),pg_temp.c_id('past'),'Historical fixture','b0000000-0000-4000-8000-000000000004',false);
insert into public.leagues(id,pool_id,commissioner_id,ruleset_id,name,format,status,max_members,invite_code)
select pg_temp.c_id('filter-league-'||n),case when n=3 then pg_temp.c_id('past-pool') else 'b0000000-0000-4000-8000-000000000003'::uuid end,
  pg_temp.c_id('admin'),'b0000000-0000-4000-8000-000000000004','Centre League '||n,'head_to_head',status::public.league_status,4,'CENTRE'||n
from(values(1,'setup'),(2,'complete'),(3,'archived'))x(n,status);
select pg_temp.c_actor('admin');set local role authenticated;
select is((public.admin_list_leagues_filtered('{}','{}','Centre League')->>'filteredCount')::int,3,'clearing both groups includes all matching seasons and statuses');
select is((public.admin_list_leagues_filtered(array['current'],array['open','complete'],'Centre League')->>'filteredCount')::int,2,'multiple statuses use union semantics within the current season');
select is((public.admin_list_leagues_filtered(array['current','2025-26'],array['setup','archived'],'Centre League')->>'filteredCount')::int,2,'season and status groups combine without duplicate leagues');
select is((public.admin_list_leagues_filtered(array['current'],array['open'],'Centre League')->>'totalCount')::int,3,'directory denominator includes leagues outside the active filters');
select is((public.admin_list_leagues('all','all','Centre League')->>'filteredCount')::int,3,'legacy All bookmarks retain their behavior');
select throws_ok($$select public.publish_preseason_rankings(pg_temp.c_id('past-pool'),'unused','Historical write attempt','historical-write')$$,'42501','Only current season rankings can be published','legacy publication RPC also enforces historical read-only access');
reset role;

insert into public.sports(code,name) values('basketball','Basketball'),('volleyball','Volleyball') on conflict(code)do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id)
select pg_temp.c_id(division||'-'||code||'-competition'),sport.id,division::public.division_code,'Schedule fixture '||division||' '||code,'2026-27','b0000000-0000-4000-8000-000000000004'
from public.sports sport cross join unnest(array['womens','mens'])division where code in('basketball','volleyball');
insert into public.teams(id,competition_id,name,short_name,is_brock)
select pg_temp.c_id(division||'-'||code||'-team'),pg_temp.c_id(division||'-'||code||'-competition'),'Brock schedule '||division||' '||code,'BRO',true
from public.sports sport cross join unnest(array['womens','mens'])division where code in('basketball','volleyball');
insert into public.official_schedule_sources(id,competition_id,team_id,program,url)
select pg_temp.c_id(division||'-'||code||'-source'),case when code='hockey' then pg_temp.c_id(division||'-competition') else pg_temp.c_id(division||'-'||code||'-competition')end,
case when code='hockey' then pg_temp.c_id(division||'-team')else pg_temp.c_id(division||'-'||code||'-team')end,division||'_'||code,
'https://gobadgers.ca/sports/'||case when division='mens' then 'mens-' else 'womens-'end||case when code='hockey' then 'ice-hockey'else code::text end||'/schedule/2026-27?grid=true'
from public.sports cross join unnest(array['womens','mens'])division where code in('hockey','basketball','volleyball')on conflict(program)do nothing;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select public.begin_schedule_sync(pg_temp.c_id('schedule-success'));
select public.record_schedule_sync(pg_temp.c_id('schedule-success'),id,'succeeded',1,null,now()) from public.official_schedule_sources;
select public.record_schedule_sync(pg_temp.c_id('schedule-success'),(select id from public.official_schedule_sources limit 1),'succeeded',1,null,now());
select ok(public.finish_schedule_sync(pg_temp.c_id('schedule-success')),'schedule invocation finalizes after all source outcomes');
select ok(not public.finish_schedule_sync(pg_temp.c_id('schedule-success')),'finished invocations cannot be finalized twice');
reset role;
select is((select status::text from public.sync_runs where id=pg_temp.c_id('schedule-success')),'succeeded','all six successful source outcomes produce a successful run');
select is((select updated_count from public.sync_runs where id=pg_temp.c_id('schedule-success')),6,'repeated source receipts never double count changes');
insert into public.sync_errors(error_code,message,context) select 'OFFICIAL_SCHEDULE_SYNC','do-not-leak',jsonb_build_object('source_id',id) from public.official_schedule_sources order by id limit 1;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select public.begin_schedule_sync(pg_temp.c_id('schedule-partial'));
select public.record_schedule_sync(pg_temp.c_id('schedule-partial'),(select id from public.official_schedule_sources order by id limit 1),'failed',3,'SOURCE_REVIEW_REQUIRED',now());
select public.finish_schedule_sync(pg_temp.c_id('schedule-partial'));
reset role;
select is((select status::text from public.sync_runs where id=pg_temp.c_id('schedule-partial')),'failed','partial schedule invocations are failed rather than reporting false success');
select is((select updated_count from public.sync_runs where id=pg_temp.c_id('schedule-partial')),3,'partial failures retain successfully applied change counts');
select pg_temp.c_actor('admin');set local role authenticated;
select is(public.admin_get_operations('runs','schedule',p_query=>pg_temp.c_id('schedule-partial')::text)->'items'->0->>'alert_count','1','failed program outcomes link to their retained alert');
select is(jsonb_array_length(public.admin_get_operations('alerts','schedule',p_query=>pg_temp.c_id('schedule-partial')::text)->'items'),1,'run drilldown finds associated schedule alerts');
select ok(public.admin_get_operations('runs','schedule')?'legacySources','current source health remains available alongside new run history');
select throws_ok($$select public.begin_schedule_sync(pg_temp.c_id('untrusted-worker'))$$,'42501',null,'administrators cannot invoke service-worker commands directly');
reset role;
select * from finish();
rollback;
