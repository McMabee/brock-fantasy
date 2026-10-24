begin;
select no_plan();
create function pg_temp.b_id(text) returns uuid language sql immutable as $$ select md5('backlog-forecasts:'||$1)::uuid; $$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.b_id('user'||n),'backlog-'||n||'@example.test',now(),now(),jsonb_build_object('display_name','Backlog test '||n,'varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1') from generate_series(1,3)n;
insert into auth.sessions(id,user_id,aal) select pg_temp.b_id('user'||n),pg_temp.b_id('user'||n),'aal1' from generate_series(1,3)n;
insert into public.sports(code,name) values('hockey','Hockey') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.b_id('competition'),id,'mens','Backlog hockey','backlog-fixture','b0000000-0000-4000-8000-000000000004',true from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name,is_brock) values(pg_temp.b_id('program'),pg_temp.b_id('competition'),'Backlog Brock','BRO',true);
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
select pg_temp.b_id('athlete'||n),pg_temp.b_id('competition'),pg_temp.b_id('program'),'Backlog athlete '||n,'F','{}' from generate_series(1,3)n;
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select pg_temp.b_id('athlete'||n),'b0000000-0000-4000-8000-000000000002',pg_temp.b_id('competition'),pg_temp.b_id('program'),array['F'],true,true from generate_series(1,3)n;
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
values(pg_temp.b_id('league'),'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004',pg_temp.b_id('user1'),'Backlog league','BACKLOG170',4,'head_to_head','active');
insert into public.league_members(league_id,user_id,role) select pg_temp.b_id('league'),pg_temp.b_id('user'||n),(case when n=1 then 'commissioner' else 'member' end)::public.league_member_role from generate_series(1,2)n;
insert into public.fantasy_teams(id,league_id,owner_id,name) select pg_temp.b_id('team'||n),pg_temp.b_id('league'),pg_temp.b_id('user'||n),'Backlog team '||n from generate_series(1,2)n;
insert into public.roster_entries(league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type)
select pg_temp.b_id('league'),pg_temp.b_id('team'||n),pg_temp.b_id('athlete'||n),'HK_F','starter','draft' from generate_series(1,2)n;

update public.player_pools set is_active=true where id='b0000000-0000-4000-8000-000000000003';
insert into public.pool_competitions(pool_id,competition_id) values('b0000000-0000-4000-8000-000000000003',pg_temp.b_id('competition'));
insert into public.athlete_season_summaries(athlete_id,season_label,source,fantasy_points,games_played,kind)
select pg_temp.b_id('athlete'||n),'2026-27','backlog fixture',case when n<3 then 100 else null end,20,'supplied_projection' from generate_series(1,3)n;
insert into public.user_roles(user_id,role) values(pg_temp.b_id('user1'),'admin');
update auth.sessions set aal='aal2' where id=pg_temp.b_id('user1');
select set_config('request.jwt.claim.sub',pg_temp.b_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user1'),'session_id',pg_temp.b_id('user1'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
create temp table ranking_preview as select public.preview_preseason_rankings('b0000000-0000-4000-8000-000000000003') data;
select is((select jsonb_array_length(data->'rows') from ranking_preview),3,'ranking preview includes every participating directory athlete');
select lives_ok($$select public.publish_preseason_rankings('b0000000-0000-4000-8000-000000000003',(select data->>'input_hash' from ranking_preview),'Reviewed fixture projection order','rankings-first')$$,'MFA administrator can publish a reviewed snapshot');
select is((select count(*)::int from public.preseason_ranking_entries where position_rank=1),2,'equal season projections share a position rank');
select is((select count(*)::int from public.preseason_ranking_entries where position_rank is null),1,'missing projections remain explicitly unranked');
select lives_ok($$select public.publish_preseason_rankings('b0000000-0000-4000-8000-000000000003',(select data->>'input_hash' from ranking_preview),'Reviewed fixture projection order','rankings-first')$$,'ranking publication retry is idempotent');
select is((select count(*)::int from public.preseason_ranking_publications),1,'retry does not create another snapshot');
select is((public.get_player_forecast('b0000000-0000-4000-8000-000000000003',pg_temp.b_id('athlete1'))->>'projectedSeasonPoints')::numeric,100::numeric,'forecast uses the canonical supplied season projection');
select is((public.get_player_forecast('b0000000-0000-4000-8000-000000000003',pg_temp.b_id('athlete1'))->>'knownSchedule')::boolean,false,'unknown schedule is distinct from a known zero-game period');
reset role;
update public.athlete_season_summaries set fantasy_points=500 where athlete_id=pg_temp.b_id('athlete1');
select is((select projected_points from public.preseason_ranking_entries where athlete_id=pg_temp.b_id('athlete1')),100::numeric,'published snapshot is unchanged by later projection edits');
select set_config('request.jwt.claim.sub',pg_temp.b_id('user1')::text,true);
set local role authenticated;
select throws_ok($$select public.publish_preseason_rankings('b0000000-0000-4000-8000-000000000003',(select data->>'input_hash' from ranking_preview),'Reviewed fixture projection order','rankings-stale')$$,'PT409','Ranking inputs changed; preview and review again','stale ranking inputs require another review');
reset role;
update public.athletes set fantasy_withdrawn_at=now() where id=pg_temp.b_id('athlete2');
select set_config('request.jwt.claim.sub',pg_temp.b_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user2'),'session_id',pg_temp.b_id('user2'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select is(jsonb_array_length(public.get_preseason_rankings('b0000000-0000-4000-8000-000000000003')->'rows'),2,'withdrawals stay suppressed in published ranking reads');
select throws_ok($$select public.preview_preseason_rankings('b0000000-0000-4000-8000-000000000003')$$,'42501','Administrator MFA required','participant cannot publish or preview privileged ranking inputs');
select throws_ok($$insert into public.preseason_ranking_publications(pool_id,version,input_hash,reason) values('b0000000-0000-4000-8000-000000000003',99,'bad','unauthorized')$$,'42501',null,'participant cannot write ranking snapshots directly');
reset role;
select * from finish();rollback;
