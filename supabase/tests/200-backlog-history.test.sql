begin;
select no_plan();
create function pg_temp.b_id(text) returns uuid language sql immutable as $$ select md5('backlog-history:'||$1)::uuid; $$;
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
reset role;
update public.athletes set bio=jsonb_build_object('program','mens_hockey','headshot',jsonb_build_object('sourceUrl','https://gobadgers.ca/sports/mens-ice-hockey/roster/fixture/999'));
create temp table archive_input as select jsonb_build_array(jsonb_build_object(
 'athlete_id',pg_temp.b_id('athlete1'),'program','mens_hockey','season_label','2025-26','source_game_id','123','played_at','2025-11-01T23:00:00Z','phase','regular','opponent','Fixture opponent','result','W, 3-1',
 'source_url','https://gobadgers.ca/sports/mens-ice-hockey/stats/2025-26/fixture/boxscore/123','source_hash',repeat('a',64),'positions',jsonb_build_array('F'),'stats',jsonb_build_object('goals',1,'assists',0),
 'identity_evidence',jsonb_build_object('basis','official_career_link','current_profile_url','https://gobadgers.ca/sports/mens-ice-hockey/roster/fixture/999','historical_player_id','1234','career_source_hash',repeat('b',64),'position_source_hash',repeat('c',64)))) data;
grant select on archive_input to authenticated;
set local role authenticated;

create temp table history_preview as select public.stage_historical_game_logs((select data from archive_input)) data;
select is((select (data#>>'{rows,0,complete}')::boolean from history_preview),false,'missing historical inputs withhold fantasy points');
select is((select data#>'{rows,0,fantasy_points}' from history_preview),'null'::jsonb,'missing statistics are never silently scored as zero');
select lives_ok($$select public.publish_historical_game_logs((select (data->>'batch_id')::uuid from history_preview),(select data->>'input_hash' from history_preview),'Reviewed official career identity and box score','history-first')$$,'reviewed archival publication succeeds');
select lives_ok($$select public.publish_historical_game_logs((select (data->>'batch_id')::uuid from history_preview),(select data->>'input_hash' from history_preview),'Reviewed official career identity and box score','history-first')$$,'archival publication retry is idempotent');
select is(jsonb_array_length(public.get_historical_game_logs(pg_temp.b_id('athlete1'))),1,'one verified historical appearance is visible');
select throws_ok($$select public.stage_historical_game_logs(jsonb_set((select data from archive_input),'{0,phase}','"exhibition"'))$$,'P0001','Invalid official archival source or appearance','exhibitions cannot enter the archive');
select throws_ok($$select public.stage_historical_game_logs(jsonb_set((select data from archive_input),'{0,identity_evidence,basis}','"name_match"'))$$,'P0001','Verified official career identity evidence is required','name-only historical identity is rejected');
reset role;
select is((select count(*)::int from public.fantasy_point_events),0,'historical publication creates no live fantasy point events');
update public.athletes set fantasy_withdrawn_at=now() where id=pg_temp.b_id('athlete1');
select set_config('request.jwt.claim.sub',pg_temp.b_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user2'),'session_id',pg_temp.b_id('user2'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select is((select count(*)::int from public.athlete_historical_game_logs),0,'withdrawal suppresses archived athlete details');
select throws_ok($$select public.get_historical_game_logs(pg_temp.b_id('athlete1'))$$,'42501','Player unavailable','withdrawn historical logs cannot be fetched by RPC');
select throws_ok($$select public.stage_historical_game_logs((select data from archive_input))$$,'42501','Administrator MFA required','ordinary participants cannot stage archival data');
select is((select count(*)::int from public.historical_game_log_batches),0,'participants cannot read review batches');
reset role;
select * from finish();rollback;
