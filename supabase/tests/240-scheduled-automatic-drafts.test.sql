begin;
select no_plan();
-- - Keep draft fixtures independent of the published season start date
update public.fantasy_periods set starts_at=now()+make_interval(days=>number*7),ends_at=now()+make_interval(days=>number*7+6);
create function pg_temp.v_id(text) returns uuid language sql immutable as $$ select md5('varsity-fixture:'||$1)::uuid; $$;

insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.v_id('user'||n),'varsity-'||n||'@example.test',now(),now(),jsonb_build_object('display_name','Participant '||n,
  'varsity_role',case when n=1 then 'athlete' else 'none' end,'varsity_programs',case when n=1 then '["womens_volleyball"]'::jsonb else '[]'::jsonb end,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from generate_series(1,9)n;
insert into auth.sessions(id,user_id,aal) select pg_temp.v_id('user'||n),pg_temp.v_id('user'||n),(case when n=9 then 'aal2' else 'aal1' end)::auth.aal_level from generate_series(1,9)n;
insert into public.user_roles(user_id,role) values(pg_temp.v_id('user9'),'admin');
insert into public.sports(code,name) values('hockey','Hockey'),('basketball','Basketball'),('volleyball','Volleyball') on conflict(code) do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id,is_active)
select pg_temp.v_id(program),s.id,division::public.division_code,program,'varsity-fixture','b0000000-0000-4000-8000-000000000004',true
from (values('mens_hockey','hockey','mens'),('womens_hockey','hockey','womens'),('mens_basketball','basketball','mens'),('womens_basketball','basketball','womens'),('mens_volleyball','volleyball','mens'),('womens_volleyball','volleyball','womens'))p(program,sport,division)
join public.sports s on s.code::text=p.sport;
insert into public.teams(id,competition_id,name,short_name,is_brock)
select pg_temp.v_id(c.name||'-team'),c.id,'Brock '||c.name,'BRO',true from public.competitions c where season_label='varsity-fixture';
insert into public.athletes(id,competition_id,team_id,display_name,position,bio)
select pg_temp.v_id(c.name||n),c.id,t.id,c.name||' athlete '||n,
  case when c.name like '%hockey' then (array['F','D','G'])[1+(n%3)] when c.name like '%basketball' then (array['BC','FC'])[1+(n%2)] else (array['HT','L','S'])[1+(n%3)] end,
  jsonb_build_object('program',c.name)
from public.competitions c join public.teams t on t.competition_id=c.id cross join generate_series(1,24)n where c.season_label='varsity-fixture';
insert into public.player_pools(id,season_id,ruleset_id,name,is_active,rankings_approved_at)
values(pg_temp.v_id('pool'),'b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004','Varsity test pool',true,now());
insert into public.pool_competitions(pool_id,competition_id) select pg_temp.v_id('pool'),id from public.competitions where season_label='varsity-fixture';
insert into public.athlete_seasons(athlete_id,season_id,competition_id,team_id,positions,directory_visible,draft_eligible)
select a.id,'b0000000-0000-4000-8000-000000000002',a.competition_id,a.team_id,array[a.position],true,true from public.athletes a join public.competitions c on c.id=a.competition_id where c.season_label='varsity-fixture';
insert into public.pool_rankings(pool_id,athlete_id,rank) select pg_temp.v_id('pool'),a.id,row_number() over(order by a.id) from public.athletes a join public.competitions c on c.id=a.competition_id where c.season_label='varsity-fixture';
update public.pool_rankings set reviewed=true,basis='Reviewed isolated varsity fixture' where pool_id=pg_temp.v_id('pool');
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,format,max_members,invite_code)
values(pg_temp.v_id('league'),pg_temp.v_id('pool'),'b0000000-0000-4000-8000-000000000004',pg_temp.v_id('user1'),'Varsity test','head_to_head',8,'VARSTEST');
insert into public.league_members(league_id,user_id,role) select pg_temp.v_id('league'),pg_temp.v_id('user'||n),case when n=1 then 'commissioner'::public.league_member_role else 'member'::public.league_member_role end from generate_series(1,8)n;
insert into public.fantasy_teams(id,league_id,owner_id,name,draft_position,preseason_order,waiver_priority) select pg_temp.v_id('team'||n),pg_temp.v_id('league'),pg_temp.v_id('user'||n),'Team '||n,n,n,n from generate_series(1,8)n;

update public.fantasy_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '5 days' where season_id='b0000000-0000-4000-8000-000000000002' and number=1;



delete from public.fantasy_teams where league_id=pg_temp.v_id('league')and owner_id not in(select pg_temp.v_id('user'||n)from generate_series(1,4)n);
delete from public.league_members where league_id=pg_temp.v_id('league')and user_id not in(select pg_temp.v_id('user'||n)from generate_series(1,4)n);
update public.leagues set max_members=4 where id=pg_temp.v_id('league');
create temp table preferred as select r.athlete_id from public.pool_rankings r join public.athlete_seasons s on s.athlete_id=r.athlete_id where r.pool_id=pg_temp.v_id('pool')and s.competition_id=pg_temp.v_id('mens_volleyball')order by r.rank desc limit 1;
grant select on preferred to authenticated;
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
select throws_ok($$select public.configure_league_draft(pg_temp.v_id('league'),'scheduled_auto',now()+interval '1 hour',(select state_version from public.leagues where id=pg_temp.v_id('league')),'auto-disabled')$$,'22023','Automatic drafting is not enabled yet','schema installation does not enable automatic drafting');
reset role;
update beta_private.release_controls set automatic_drafts_enabled=true,mode_selection_required=true;
set local role authenticated;
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'auto-unselected')$$,'22023','Select a draft mode before starting','commissioner must explicitly select a draft mode');
select lives_ok($$select public.configure_league_draft(pg_temp.v_id('league'),'scheduled_auto',now()+interval '1 hour',(select state_version from public.leagues where id=pg_temp.v_id('league')),'auto-configure')$$,'commissioner arms a future automatic draft');
select lives_ok($$select public.save_draft_preferences(pg_temp.v_id('league'),array[(select athlete_id from preferred)],0,'auto-preference')$$,'owner saves private preferences');
select lives_ok($$select public.save_draft_preferences(pg_temp.v_id('league'),array[(select athlete_id from preferred)],0,'auto-preference')$$,'preference receipt is safe to retry');
select throws_ok($$select public.save_draft_preferences(pg_temp.v_id('league'),'{}',0,'auto-preference-stale')$$,'PT409','Preferences changed; reload before saving','a second tab cannot overwrite a newer preference list');
select throws_ok($$select * from beta_private.draft_preferences$$,'42501',null,'clients cannot directly read preference storage');
select is((public.get_league_draft_setup(pg_temp.v_id('league'))->>'preferenceVersion')::int,1,'owner sees the saved preference revision');
select throws_ok($$select public.start_draft(pg_temp.v_id('league'),10,120,'auto-start-manual')$$,'22023','The system starts this draft at its scheduled time','commissioner cannot start an automatic draft early');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.v_id('user2')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user2'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user2'))::text,true);
set local role authenticated;
select is(jsonb_array_length(public.get_league_draft_setup(pg_temp.v_id('league'))->'preferences'),0,'another manager cannot read the commissioner preference list');
select throws_ok($$select public.configure_league_draft(pg_temp.v_id('league'),'live',null,0,'auto-member-config')$$,'42501','Commissioner access required','ordinary managers cannot select the league mode');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.process_expired_drafts(25)$$,'worker tolerates future automatic drafts');
reset role;
select is((select count(*)::int from public.drafts where league_id=pg_temp.v_id('league')),0,'worker makes no early draft');
update public.leagues set draft_scheduled_for=clock_timestamp()-interval '1 second'where id=pg_temp.v_id('league');
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
select throws_ok($$select public.save_draft_preferences(pg_temp.v_id('league'),'{}',1,'auto-after-cutoff')$$,'22023','Preference editing is closed','deadline is enforced by the database');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.process_expired_drafts(25)$$,'worker starts and advances the due draft');
reset role;
select is((select mode from public.drafts where league_id=pg_temp.v_id('league')),'scheduled_auto','draft freezes its execution mode');
select ok((select count(*) between 1 and 5 from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=pg_temp.v_id('league')),'one tick commits at most five picks');
select is((select count(*)::int from public.matchups where league_id=pg_temp.v_id('league')),0,'an incomplete automatic draft has no matchups');
select is((select count(*)::int from beta_private.draft_preference_snapshots s join public.drafts d on d.id=s.draft_id where d.league_id=pg_temp.v_id('league')),4,'one private snapshot is captured per manager');
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
select throws_ok($$select public.make_draft_pick((select id from public.drafts where league_id=pg_temp.v_id('league')),(select athlete_id from preferred),'auto-manual-pick','commissioner',null)$$,'22023','The system makes picks in automatic mode','commissioner cannot override automatic picks');
select throws_ok($$select public.admin_get_draft_preferences((select id from public.drafts where league_id=pg_temp.v_id('league')),pg_temp.v_id('team2'),'Support investigation')$$,'42501','Administrator MFA required','commissioner cannot use support access to see private rankings');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$begin
  for i in 1..40 loop
    exit when exists(select 1 from public.drafts where league_id=pg_temp.v_id('league')and status='complete');
    perform public.process_expired_drafts(25);
  end loop;
end$$;
select is((select count(*)::int from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=pg_temp.v_id('league')),40,'default rankings complete all ten-round rosters');
select is((select status::text from public.leagues where id=pg_temp.v_id('league')),'active','completed draft activates the league');
select is((select athlete_id from public.draft_picks where fantasy_team_id=pg_temp.v_id('team1')order by overall_pick limit 1),(select athlete_id from preferred),'manager preference wins before approved defaults');
select is((select count(*)::int from public.matchups where league_id=pg_temp.v_id('league')),14,'completion generates only the eligible regular periods');
select ok((select bool_and(s.expires_at=d.completed_at+interval '30 days')from beta_private.draft_preference_snapshots s join public.drafts d on d.id=s.draft_id where d.league_id=pg_temp.v_id('league')),'private rankings expire thirty days after actual completion');
select is((select count(*)::int from public.notifications where kind='draft_completed'and data->>'league_id'=pg_temp.v_id('league')::text),4,'completion notice is deduplicated per current member');
select lives_ok($$select public.process_expired_drafts(25)$$,'completed automatic drafts tolerate more worker ticks');
select is((select count(*)::int from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=pg_temp.v_id('league')),40,'worker retries cannot duplicate completed picks');
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,format,max_members,invite_code)values(pg_temp.v_id('blocked-league'),pg_temp.v_id('pool'),'b0000000-0000-4000-8000-000000000004',pg_temp.v_id('user1'),'Blocked automatic fixture','head_to_head',4,'BLOCKAUTO');
insert into public.league_members(league_id,user_id,role)values(pg_temp.v_id('blocked-league'),pg_temp.v_id('user1'),'commissioner');
select set_config('request.jwt.claim.sub',pg_temp.v_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.v_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.v_id('user1'))::text,true);
set local role authenticated;
select lives_ok($$select public.configure_league_draft(pg_temp.v_id('blocked-league'),'scheduled_auto',now()+interval '1 hour',(select state_version from public.leagues where id=pg_temp.v_id('blocked-league')),'auto-blocked-setup')$$,'an incomplete league may plan a future draft');
reset role;
update public.leagues set draft_scheduled_for=clock_timestamp()-interval '1 second'where id=pg_temp.v_id('blocked-league');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$select public.process_expired_drafts(25)$$,'unready leagues do not break the worker');
select is((select draft_setup_state from public.leagues where id=pg_temp.v_id('blocked-league')),'blocked','unready league is terminally blocked until rescheduled');
select is((select count(*)::int from public.drafts where league_id=pg_temp.v_id('blocked-league')),0,'blocked setup makes no draft or picks');
select lives_ok($$select public.process_expired_drafts(25)$$,'later ticks skip a blocked setup');
select is((select count(*)::int from public.notifications where kind='draft_blocked'and data->>'league_id'=pg_temp.v_id('blocked-league')::text),1,'a blocker sends one notice rather than an error loop');
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
values(pg_temp.v_id('user10'),'auto-10@example.test',now(),now(),jsonb_build_object('display_name','Automatic manager ten','varsity_role','none','varsity_programs','[]'::jsonb,'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1'));
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,format,max_members,invite_code,draft_mode,draft_setup_state,draft_scheduled_for)
select pg_temp.v_id('size-'||n),pg_temp.v_id('pool'),'b0000000-0000-4000-8000-000000000004',pg_temp.v_id('user1'),'Automatic size '||n,'head_to_head',n,'AUTOSIZE'||n,'scheduled_auto','armed',clock_timestamp()-interval '1 second'from unnest(array[6,8,10])n;
insert into public.league_members(league_id,user_id,role)select l.id,pg_temp.v_id('user'||n),case when n=1 then'commissioner'::public.league_member_role else'member'::public.league_member_role end
from public.leagues l cross join lateral generate_series(1,l.max_members)n where l.invite_code::text like'AUTOSIZE%';
insert into public.fantasy_teams(id,league_id,owner_id,name,preseason_order,waiver_priority)
select pg_temp.v_id(l.invite_code||'-team-'||n),l.id,pg_temp.v_id('user'||n),'Team '||n,n,n
from public.leagues l cross join lateral generate_series(1,l.max_members)n where l.invite_code::text like'AUTOSIZE%';
update beta_private.release_controls set automatic_drafts_enabled=false;
select public.process_expired_drafts(25);
select is((select count(*)from public.drafts d join public.leagues l on l.id=d.league_id where l.invite_code::text like'AUTOSIZE%'),0::bigint,'rollback disables new starts while preserving committed drafts');
update beta_private.release_controls set automatic_drafts_enabled=true;
select public.process_expired_drafts(25);
select is((select count(distinct d.league_id)from public.draft_picks p join public.drafts d on d.id=p.draft_id join public.leagues l on l.id=d.league_id where l.invite_code::text like'AUTOSIZE%'),3::bigint,'fair worker rotation advances every ready league');
select ok(not exists(select d.league_id from public.draft_picks p join public.drafts d on d.id=p.draft_id join public.leagues l on l.id=d.league_id where l.invite_code::text like'AUTOSIZE%'group by d.league_id having count(*)>5),'parallel ready leagues each commit at most five picks per tick');
do $$begin for i in 1..100 loop
  exit when not exists(select 1 from public.leagues where invite_code::text like'AUTOSIZE%'and status<>'active');
  perform public.process_expired_drafts(25);
end loop;end$$;
select is((select count(*)from public.draft_picks p join public.drafts d on d.id=p.draft_id where d.league_id=pg_temp.v_id('size-'||n)),(n*10)::bigint,'automatic draft completes ten legal picks per manager at size '||n)from unnest(array[6,8,10])n;
select ok(not exists(select t.id from public.fantasy_teams t join public.leagues l on l.id=t.league_id left join public.roster_entries r on r.fantasy_team_id=t.id and r.released_at is null where l.invite_code::text like'AUTOSIZE%'group by t.id having count(r.id)<>10 or count(r.id)filter(where r.status='starter')<>7),'all supported sizes retain seven starters and three reserves');
select is((select count(*)from public.matchups where league_id=pg_temp.v_id('size-8')),24::bigint,'late eight-manager draft uses the six remaining periods within its seven-round limit');
select * from finish();
rollback;
