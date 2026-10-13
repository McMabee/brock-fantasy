begin;
select plan(5);

insert into public.fantasy_seasons(id,label,rule_version,trade_deadline)
values('97000000-0000-4000-8000-000000000001','draft-completion-fixture','fixture',now()+interval '1 year');
insert into public.scoring_rulesets(id,sport,name,version,status,approved_at)
values('97000000-0000-4000-8000-000000000002','hockey','Draft completion fixture',1,'approved',now());
insert into public.roster_slot_rules(ruleset_id,slot_code,label,allowed_positions,slot_count,is_starter)
values
('97000000-0000-4000-8000-000000000002','HK_F','Fixture starter',array['F'],1,true),
('97000000-0000-4000-8000-000000000002','BN','Fixture bench',array['F'],1,false);
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id)
select '97000000-0000-4000-8000-000000000003',id,'mens','Draft completion fixture','fixture',
 '97000000-0000-4000-8000-000000000002' from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name)
values('97000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000003','Fixture team','FIX');
insert into public.player_pools(id,season_id,ruleset_id,name)
values('97000000-0000-4000-8000-000000000005','97000000-0000-4000-8000-000000000001',
 '97000000-0000-4000-8000-000000000002','Draft completion fixture');
insert into public.pool_competitions(pool_id,competition_id)
values('97000000-0000-4000-8000-000000000005','97000000-0000-4000-8000-000000000003');
insert into public.leagues(id,pool_id,ruleset_id,name,format,max_members,invite_code)
values('97000000-0000-4000-8000-000000000006','97000000-0000-4000-8000-000000000005',
 '97000000-0000-4000-8000-000000000002','Draft completion fixture','head_to_head',4,'fixture-draft-completion');
insert into public.fantasy_teams(id,league_id,name)
values('97000000-0000-4000-8000-000000000007','97000000-0000-4000-8000-000000000006','Fixture manager');
insert into public.athletes(id,competition_id,team_id,display_name,position)
select id,'97000000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000004','Fixture player','F'
from (values
 ('97000000-0000-4000-8000-000000000008'::uuid),
 ('97000000-0000-4000-8000-000000000009'::uuid),
 ('97000000-0000-4000-8000-000000000010'::uuid)
) fixture(id);
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions)
select id,'97000000-0000-4000-8000-000000000001',competition_id,team_id,array['F']
from public.athletes where competition_id='97000000-0000-4000-8000-000000000003';

select ok(beta_private.draft_completion('97000000-0000-4000-8000-000000000006') is not null,
 'the fixture can fill its starter and bench');
-- This candidate sorts after enough unowned alternatives to fill both slots.
-- The old ordering returned null even though the proposed pick is legal.
select ok(beta_private.draft_completion('97000000-0000-4000-8000-000000000006',
 '97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000007') is not null,
 'a proposed pick is retained ahead of unowned alternatives');
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
values('97000000-0000-4000-8000-000000000006','97000000-0000-4000-8000-000000000007',
 '97000000-0000-4000-8000-000000000008','HK_F','starter','draft');
select is((select count(*)::integer from jsonb_object_keys(beta_private.draft_completion('97000000-0000-4000-8000-000000000006',
 '97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000007')->'owners')),2,
 'completion retains both an existing pick and the proposed pick');
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
values('97000000-0000-4000-8000-000000000006','97000000-0000-4000-8000-000000000007',
 '97000000-0000-4000-8000-000000000009','BN','bench','draft');
select ok(beta_private.draft_completion('97000000-0000-4000-8000-000000000006',
 '97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000007') is null,
 'a proposed pick cannot exceed roster capacity');
select ok(not has_function_privilege('authenticated','beta_private.match_owned_athlete(jsonb,jsonb,jsonb,jsonb,integer[])','execute'),
 'the new owned-athlete matcher cannot be called by clients');

select * from finish();
rollback;
