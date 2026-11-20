begin;
select no_plan();
create function pg_temp.av_id(text) returns uuid language sql immutable as $$select md5('availability:'||$1)::uuid;$$;
create function pg_temp.av_actor(name text,aal text default 'aal2') returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',pg_temp.av_id(name)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.av_id(name),'session_id',pg_temp.av_id(name),'role','authenticated','aal',aal)::text,true);
end;$$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.av_id(name),name||'@availability.test',now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from unnest(array['admin','admin2','manager','manager2','outsider'])name;
insert into auth.sessions(id,user_id,aal) select id,id,'aal2' from auth.users where email like '%@availability.test';
insert into public.user_roles(user_id,role) values(pg_temp.av_id('admin'),'admin'),(pg_temp.av_id('admin2'),'admin');
insert into public.sports(code,name) values('hockey','Hockey') on conflict(code)do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.av_id('competition'),id,'mens','Availability Hockey','availability-fixture','b0000000-0000-4000-8000-000000000004',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name)values(pg_temp.av_id('program'),pg_temp.av_id('competition'),'Availability Badgers','AV');
insert into public.athletes(id,competition_id,team_id,display_name,position)
select pg_temp.av_id(name),pg_temp.av_id('competition'),pg_temp.av_id('program'),name,'F' from unnest(array['athlete','other','hidden'])name;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible)
select pg_temp.av_id(name),'b0000000-0000-4000-8000-000000000002',pg_temp.av_id('competition'),pg_temp.av_id('program'),array['F'],name<>'hidden' from unnest(array['athlete','other','hidden'])name;
insert into public.leagues(id,competition_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
select pg_temp.av_id('league'||n),pg_temp.av_id('competition'),'b0000000-0000-4000-8000-000000000004',pg_temp.av_id('manager'),'Availability league '||n,'AVAIL'||n,4,'head_to_head',status::public.league_status
from(values(1,'active'),(2,'drafting'),(3,'setup'),(4,'complete'),(5,'archived'),(6,'active'),(7,'active'))x(n,status);
insert into public.league_members(league_id,user_id,role)
select pg_temp.av_id('league'||n),pg_temp.av_id(case when n=3 then 'manager2' else 'manager' end),'commissioner' from generate_series(1,7)n;
insert into public.fantasy_teams(id,league_id,owner_id,name)
select pg_temp.av_id('team'||n),pg_temp.av_id('league'||n),pg_temp.av_id(case when n=3 then 'manager2' else 'manager' end),'Availability team '||n from generate_series(1,7)n;
insert into public.roster_entries(id,league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type,released_at)
select pg_temp.av_id('roster'||n),pg_temp.av_id('league'||n),pg_temp.av_id('team'||n),pg_temp.av_id(case when n=7 then 'other' else 'athlete' end),
case when n=2 then 'BN' else 'HK_F' end,case when n=2 then 'bench' else 'starter' end::public.roster_status,'draft',case when n=6 then now() end from generate_series(1,7)n;
insert into public.teams(id,competition_id,name,short_name)values(pg_temp.av_id('away'),pg_temp.av_id('competition'),'Availability visitors','VIS');
insert into public.games(id,competition_id,home_team_id,away_team_id,starts_at,status,stats_complete)
values(pg_temp.av_id('game'),pg_temp.av_id('competition'),pg_temp.av_id('program'),pg_temp.av_id('away'),now()-interval '2 days','final',true);
insert into public.fantasy_point_events(league_id,fantasy_team_id,athlete_id,game_id,ruleset_id,stat_key,stat_value,points,kind,source_identity)
values(pg_temp.av_id('league1'),pg_temp.av_id('team1'),pg_temp.av_id('athlete'),pg_temp.av_id('game'),'b0000000-0000-4000-8000-000000000004','fixture',1,12.5,'score','availability-earned-points');
create temp table saved_rosters as select * from public.roster_entries;
create temp table saved_points as select * from public.fantasy_point_events;
create temp table saved_eligibility as select athlete_id,draft_eligible,directory_visible from public.athlete_seasons;

select is((select availability_status from public.athletes where id=pg_temp.av_id('athlete')),'active','athletes initialize Active');
select is((select availability_revision from public.athletes where id=pg_temp.av_id('athlete')),0::bigint,'initial revision is zero');
select is((select count(*)from public.notifications where kind like 'athlete_%'),0::bigint,'baseline creates no alerts');
select throws_ok($$update public.athletes set availability_status='questionable' where id=pg_temp.av_id('athlete')$$,'23514',null,'only two availability statuses accepted');
select ok(not has_function_privilege('anon','public.admin_set_athlete_availability(uuid,text,bigint,text,text)','execute'),'anonymous callers cannot invoke mutation');
select ok(not has_function_privilege('service_role','rpc_private.admin_set_athlete_availability(uuid,text,bigint,text,text)','execute'),'service role cannot impersonate an administrator command');
select pg_temp.av_actor('outsider');set local role authenticated;
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',0,'Confirmed injury','member-attempt')$$,'42501','Administrator MFA required','ordinary manager cannot change availability');
select lives_ok($$update public.athletes set availability_status='injured' where id=pg_temp.av_id('athlete')$$,'direct update does not expose a writable row');
reset role;
select is((select availability_status from public.athletes where id=pg_temp.av_id('athlete')),'active','direct writes cannot bypass the command');
select pg_temp.av_actor('admin','aal1');set local role authenticated;
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',0,'Confirmed injury','mfa-attempt')$$,'42501','Administrator MFA required','admin without MFA denied');
reset role;select pg_temp.av_actor('admin');set local role authenticated;
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',0,'short','short-reason')$$,'22023',null,'audit reason required');
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',0,repeat('x',501),'long-reason')$$,'22023',null,'oversize reason denied');
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'unknown',0,'Confirmed injury','invalid-status')$$,'22023',null,'invalid RPC status denied');
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('hidden'),'injured',0,'Confirmed injury','hidden-athlete')$$,'22023',null,'unpublished athletes excluded');
select is(public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',0,'Private verified report','first-injury')->>'notificationCount','3','injury reaches ongoing starter and bench owners once per league');
select is(public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',0,'Private verified report','first-injury')->>'revision','1','uncertain retry retrieves original result');
select is(public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',1,'Private verified report','same-status')->>'changed','false','same status is a no-op');
reset role;
select is((select count(*)from public.audit_log where action='athlete.availability_updated'),1::bigint,'retries and unchanged saves do not duplicate audit');
select is((select count(*)from public.notifications where kind='athlete_injured'),3::bigint,'no notification duplicates');
select is((select count(*)from public.notifications where kind='athlete_injured'and user_id=pg_temp.av_id('manager2')),1::bigint,'other manager owning the athlete is notified');
select ok(not exists(select 1 from public.notifications where kind like 'athlete_%' and (data::text like '%Private%' or data ? 'reason' or data ? 'actor_id')),'notification payload excludes audit details');
select ok(exists(select 1 from public.notifications where kind='athlete_injured' and body like '%(F)%replacement for that position%' and data->>'league_id'=pg_temp.av_id('league1')::text),'injury explains athlete position and replacement action');
select is((select after_state->>'reason'from public.audit_log where action='athlete.availability_updated'),'Private verified report','private audit reason retained');
select ok(not exists((select * from saved_rosters except select * from public.roster_entries)union all(select * from public.roster_entries except select * from saved_rosters)),'injury preserves every roster and slot');
select ok(not exists((select * from saved_points except select * from public.fantasy_point_events)union all(select * from public.fantasy_point_events except select * from saved_points)),'injury preserves scoring ledger');
select ok(not exists((select * from saved_eligibility except select athlete_id,draft_eligible,directory_visible from public.athlete_seasons)union all(select athlete_id,draft_eligible,directory_visible from public.athlete_seasons except select * from saved_eligibility)),'injury preserves draft and directory eligibility');
select ok(beta_private.can_acquire_athlete(pg_temp.av_id('team7'),pg_temp.av_id('athlete')),'injured athlete remains acquirable');
select ok(beta_private.can_field_athlete(pg_temp.av_id('team1'),pg_temp.av_id('athlete'),now()),'injured athlete remains eligible to field');
select is((select count(*)from beta_private.service_email_jobs where notification_id in(select id from public.notifications where kind like 'athlete_%')),0::bigint,'status alerts never queue service email');
select pg_temp.av_actor('manager');set local role authenticated;
select is((select count(*)from public.notifications where kind like 'athlete_%'),2::bigint,'manager inbox includes only their two leagues');
select is((select count(*)from public.audit_log where action='athlete.availability_updated'),0::bigint,'managers cannot read internal reasons');
reset role;select pg_temp.av_actor('admin2');set local role authenticated;
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'active',0,'Confirmed recovery','stale-recovery')$$,'PT409',null,'stale second admin cannot overwrite status');
select is(public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'active',1,'Confirmed recovery','first-recovery')->>'notificationCount','3','recovery notifies current owners');
reset role;
update public.roster_entries set released_at=now()where id=pg_temp.av_id('roster2');
select pg_temp.av_actor('admin');set local role authenticated;
select is(public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'injured',2,'New injury confirmed','second-injury')->>'notificationCount','2','later episode creates fresh alerts and excludes released ownership');
reset role;
select is((select count(*)from public.notifications where kind like 'athlete_%'),8::bigint,'each transition has a separate deduplicated episode');
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
values(pg_temp.av_id('league7'),pg_temp.av_id('team7'),pg_temp.av_id('athlete'),'BN','bench','add');
select is((select count(*)from public.notifications where kind like 'athlete_%'),8::bigint,'acquiring an already injured athlete does not replay alerts');
update public.athletes set bio=bio||'{"imported":"updated"}'::jsonb where id=pg_temp.av_id('athlete');
select is((select availability_status from public.athletes where id=pg_temp.av_id('athlete')),'injured','roster metadata imports preserve status');
select is((select availability_revision from public.athletes where id=pg_temp.av_id('athlete')),3::bigint,'metadata imports preserve status revision');
create function pg_temp.reject_availability_notice()returns trigger language plpgsql as $$begin
  if new.kind like 'athlete_%' then raise exception 'notification failure';end if;return new;
end;$$;
create trigger availability_failure before insert on public.notifications for each row execute function pg_temp.reject_availability_notice();
set local role authenticated;
select throws_ok($$select public.admin_set_athlete_availability(pg_temp.av_id('athlete'),'active',3,'Confirmed recovery','failed-notification')$$,'P0001','notification failure','notification failure rolls the entire command back');
reset role;
select is((select availability_revision from public.athletes where id=pg_temp.av_id('athlete')),3::bigint,'failed notification preserves status revision');
select is((select count(*)from public.audit_log where action='athlete.availability_updated'),3::bigint,'failed command creates no audit');
select is((select count(*)from public.idempotency_keys where command='admin_set_athlete_availability'and idempotency_key='failed-notification'),0::bigint,'failed command can be retried');
select * from finish();
rollback;
