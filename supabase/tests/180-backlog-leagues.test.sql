begin;
select no_plan();
create function pg_temp.b_id(text) returns uuid language sql immutable as $$ select md5('backlog-leagues:'||$1)::uuid; $$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.b_id('user'||n),'backlog-'||n||'@example.test',now(),now(),jsonb_build_object('display_name','Backlog test '||n,'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1') from generate_series(1,4)n;
insert into auth.sessions(id,user_id,aal) select pg_temp.b_id('user'||n),pg_temp.b_id('user'||n),'aal1' from generate_series(1,4)n;
insert into public.sports(code,name) values('hockey','Hockey') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.b_id('competition'),id,'mens','Backlog hockey','backlog-fixture','b0000000-0000-4000-8000-000000000004',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name,is_brock) values(pg_temp.b_id('program'),pg_temp.b_id('competition'),'Backlog Brock','BRO',true);
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
select pg_temp.b_id('athlete'||n),pg_temp.b_id('competition'),pg_temp.b_id('program'),'Backlog athlete '||n,'F','{}' from generate_series(1,4)n;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select pg_temp.b_id('athlete'||n),'b0000000-0000-4000-8000-000000000002',pg_temp.b_id('competition'),pg_temp.b_id('program'),array['F'],true,true from generate_series(1,4)n;
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
values(pg_temp.b_id('league'),'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004',pg_temp.b_id('user1'),'Backlog league','BACKLOG170',4,'head_to_head','active');
insert into public.league_members(league_id,user_id,role) select pg_temp.b_id('league'),pg_temp.b_id('user'||n),(case when n=1 then 'commissioner' else 'member' end)::public.league_member_role from generate_series(1,4)n;
insert into public.fantasy_teams(id,league_id,owner_id,name) select pg_temp.b_id('team'||n),pg_temp.b_id('league'),pg_temp.b_id('user'||n),'Backlog team '||n from generate_series(1,4)n;
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
select pg_temp.b_id('league'),pg_temp.b_id('team'||n),pg_temp.b_id('athlete'||n),'HK_F','starter','draft' from generate_series(1,4)n;

update public.fantasy_periods set starts_at=now()+make_interval(days=>number*7),ends_at=now()+make_interval(days=>number*7+6) where season_id='b0000000-0000-4000-8000-000000000002';
update public.fantasy_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '5 days' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;
insert into public.drafts(league_id,status,rounds,pick_seconds,team_order) select pg_temp.b_id('league'),'complete',10,120,array_agg(pg_temp.b_id('team'||n) order by n) from generate_series(1,4)n;
select set_config('request.jwt.claim.sub',pg_temp.b_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user1'),'session_id',pg_temp.b_id('user1'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
create temp table preview as select public.get_matchup_preview(pg_temp.b_id('league')) data;
select is((select (data->>'shortened')::boolean from preview),true,'late setup explicitly previews a shortened season');
select is((select jsonb_array_length(data->'periods') from preview),7,'underway period is excluded from eligible regular-season periods');
select is((select count(*)::int from public.matchups where league_id=pg_temp.b_id('league')),0,'preview performs no schedule writes');
select throws_ok($$select public.confirm_matchup_schedule(pg_temp.b_id('league'),'stale','backlog-stale')$$,'PT409','Schedule preview changed; reload and review again','stale preview cannot generate pairings');
select lives_ok($$select public.confirm_matchup_schedule(pg_temp.b_id('league'),(select data->>'signature' from preview),'backlog-confirm')$$,'commissioner confirms the reviewed schedule');
select is((select count(*)::int from public.matchups where league_id=pg_temp.b_id('league')),14,'generation matches all previewed pairings');
select lives_ok($$select public.confirm_matchup_schedule(pg_temp.b_id('league'),(select data->>'signature' from preview),'backlog-confirm')$$,'retry returns the original confirmation');
select is((select count(*)::int from public.matchups where league_id=pg_temp.b_id('league')),14,'retry creates no duplicate pairings');
select is((select count(*)::int from public.matchups where league_id=pg_temp.b_id('league') and starts_at<now()),0,'late setup never creates retroactive matchups');
select lives_ok($$select public.get_matchup_detail(pg_temp.b_id('league'),(select id from public.matchups where league_id=pg_temp.b_id('league') limit 1))$$,'member can read a matchup breakdown');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.b_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user2'),'session_id',pg_temp.b_id('user2'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select throws_ok($$select public.get_matchup_preview(pg_temp.b_id('league'))$$,'42501','Commissioner access required','ordinary manager cannot generate a schedule');
reset role;
select * from finish();
rollback;
