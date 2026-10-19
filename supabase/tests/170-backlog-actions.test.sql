begin;
select no_plan();
create function pg_temp.b_id(text) returns uuid language sql immutable as $$ select md5('backlog-actions:'||$1)::uuid; $$;
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
select set_config('request.jwt.claim.sub',pg_temp.b_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user1'),'session_id',pg_temp.b_id('user1'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select is(jsonb_array_length(public.get_player_trade_options(pg_temp.b_id('athlete2'),pg_temp.b_id('league'))),1,'member receives trade context for an opponent-owned athlete');
select is(jsonb_array_length(public.get_player_trade_options(pg_temp.b_id('athlete1'),pg_temp.b_id('league'))),0,'own athlete is not a trade target');
select is(jsonb_array_length(public.get_player_trade_options(pg_temp.b_id('athlete3'),pg_temp.b_id('league'))),0,'unrostered athlete is not a trade target');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.b_id('user3')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user3'),'session_id',pg_temp.b_id('user3'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select is(public.get_player_trade_options(pg_temp.b_id('athlete2'),pg_temp.b_id('league')),'[]'::jsonb,'outsider receives no league ownership or trade options');
reset role;
insert into public.waiver_claims(id,league_id,fantasy_team_id,athlete_in_id,priority_at_claim,process_after)
values(pg_temp.b_id('claim'),pg_temp.b_id('league'),pg_temp.b_id('team1'),pg_temp.b_id('athlete3'),1,now());
update public.waiver_claims set status='failed' where id=pg_temp.b_id('claim');
update public.waiver_claims set status='failed' where id=pg_temp.b_id('claim');
select is((select count(*)::int from public.notifications where data->>'claim_id'=pg_temp.b_id('claim')::text),1,'repeated waiver updates create one durable outcome');
select is((select user_id from public.notifications where data->>'claim_id'=pg_temp.b_id('claim')::text),pg_temp.b_id('user1'),'waiver notification belongs to the claiming manager');
select isnt((select outcome_reason from public.waiver_claims where id=pg_temp.b_id('claim')),null::text,'failed claim exposes a safe outcome explanation');
insert into public.drafts(id,league_id,status,rounds,pick_seconds,team_order) values(pg_temp.b_id('draft'),pg_temp.b_id('league'),'active',10,120,array[pg_temp.b_id('team1'),pg_temp.b_id('team2')]);
select is((select count(*)::int from public.notifications where kind='draft_started'),2,'draft insertion notifies both league managers');
select is((select user_id from public.notifications where kind='draft_turn'),pg_temp.b_id('user1'),'first draft turn goes only to the opening manager');
update public.drafts set current_overall_pick=2 where id=pg_temp.b_id('draft');
select is((select user_id from public.notifications where kind='draft_turn' and data->>'pick'='2'),pg_temp.b_id('user2'),'next draft turn follows snake order');
update public.drafts set current_overall_pick=2 where id=pg_temp.b_id('draft');
select is((select count(*)::int from public.notifications where kind='draft_turn'),2,'unchanged turn does not duplicate notifications');
insert into public.matchups(id,league_id,period,starts_at,ends_at,home_team_id,away_team_id) values(pg_temp.b_id('matchup'),pg_temp.b_id('league'),1,now()-interval '2 days',now()-interval '1 day',pg_temp.b_id('team1'),pg_temp.b_id('team2'));
update public.matchups set status='final',home_points=12,away_points=9 where id=pg_temp.b_id('matchup');
select is((select count(*)::int from public.notifications where kind='matchup_final'),2,'final matchup notifies exactly the two participating owners');
select set_config('request.jwt.claim.sub',pg_temp.b_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.b_id('user2'),'session_id',pg_temp.b_id('user2'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select is((select count(*)::int from public.waiver_claims where id=pg_temp.b_id('claim')),0,'another manager cannot read a private claim');
select is((select count(*)::int from public.notifications where data->>'claim_id'=pg_temp.b_id('claim')::text),0,'another manager cannot read its outcome notification');
reset role;
set local role anon;
select throws_ok($$select public.get_player_trade_options(null,null)$$,'42501',null,'anonymous trade-context access is denied');
reset role;
select * from finish();
rollback;
