begin;
select plan(11);
insert into beta_private.application_access(email,reason) values('roster-reader@example.test','Explicit isolated roster reader approval');
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data) values
('99000000-0000-4000-8000-000000000099','roster-reader@example.test',now(),now(),jsonb_build_object('display_name','Roster reader','beta_age_eligible',true,
  'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::integer,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'));
insert into auth.sessions(id,user_id,aal) values('99000000-0000-4000-8000-000000000099','99000000-0000-4000-8000-000000000099','aal1');
insert into public.user_roles(user_id,role) values('99000000-0000-4000-8000-000000000099','admin');
insert into public.sports(code,name) values ('hockey','Hockey') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select '99000000-0000-4000-8000-000000000001',id,'mens','Roster test','roster-fixture',
  'b0000000-0000-4000-8000-000000000004',false from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name,is_brock) values
('99000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000001','Roster fixture','FIX',true);
insert into public.athletes(id,competition_id,team_id,display_name,position,status)
select id,'99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002',name,'F',status
from (values
 ('99000000-0000-4000-8000-000000000003'::uuid,'Visible fixture','active'),
 ('99000000-0000-4000-8000-000000000004'::uuid,'Unpublished fixture','active'),
 ('99000000-0000-4000-8000-000000000005'::uuid,'Withdrawn fixture','inactive')
) fixture(id,name,status);
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,draft_eligible,directory_visible)
select id,'b0000000-0000-4000-8000-000000000002',competition_id,team_id,array['F'],false,
 id<>'99000000-0000-4000-8000-000000000004'::uuid from public.athletes
where competition_id='99000000-0000-4000-8000-000000000001';
insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,kind)
values ('99000000-0000-4000-8000-000000000003','2026-27','fixture',0,0,'supplied_projection');
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000099","role":"authenticated","aal":"aal1","session_id":"99000000-0000-4000-8000-000000000099"}',true);
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000099',true);
set local role authenticated;
select is((select count(*)::int from public.athletes where competition_id='99000000-0000-4000-8000-000000000001'),1,'ordinary AAL1 members see only published active roster players');
select is((select count(*)::int from public.competitions where id='99000000-0000-4000-8000-000000000001'),1,'published roster program is readable without activating competition');
select is((select count(*)::int from public.teams where id='99000000-0000-4000-8000-000000000002'),1,'published team is readable');
select is((select count(*)::int from public.athletes a join public.athlete_seasons m on m.athlete_id=a.id where m.directory_visible and a.competition_id='99000000-0000-4000-8000-000000000001'),1,'directory relationship query respects RLS without recursion');
select is((select fantasy_points::int from public.athlete_season_summaries where athlete_id='99000000-0000-4000-8000-000000000003'),0,'zero projection remains zero');
select ok(not (select draft_eligible from public.athlete_seasons where athlete_id='99000000-0000-4000-8000-000000000003'),'directory display does not grant draft eligibility');
select throws_ok($$insert into public.athletes(competition_id,team_id,display_name,position) values ('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Unauthorized fixture','F')$$,'42501','new row violates row-level security policy for table "athletes"','members cannot create roster players');
select ok(not has_table_privilege('authenticated','public.athlete_seasons','UPDATE'),'members cannot publish memberships');
set local role anon;
select is((select count(*)::int from public.athletes where competition_id='99000000-0000-4000-8000-000000000001'),0,'anonymous visitors cannot read this roster');
select ok(not has_table_privilege('anon','public.source_rows','SELECT'),'anonymous visitors cannot read raw roster imports');
select throws_ok($$insert into public.athletes(competition_id,team_id,display_name,position) values ('99000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Unauthorized fixture','F')$$,'42501','new row violates row-level security policy for table "athletes"','anonymous visitors cannot write players');
reset role;
select * from finish();
rollback;
