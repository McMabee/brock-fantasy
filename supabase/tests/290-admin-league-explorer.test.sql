begin;
select no_plan();
create function pg_temp.e_id(text) returns uuid language sql immutable as $$select md5('league-explorer:'||$1)::uuid;$$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.e_id(key),email,now(),now(),jsonb_build_object('display_name',name,'varsity_role','none','varsity_programs','[]'::jsonb,
  'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1')
from(values('admin','explorer-admin@example.test','Explorer Administrator'),('member','explorer-member@example.test','Distinct Member'))t(key,email,name);
insert into auth.sessions(id,user_id,aal) select pg_temp.e_id(x),pg_temp.e_id(x),'aal2' from unnest(array['admin','member'])x;
insert into public.user_roles(user_id,role)values(pg_temp.e_id('admin'),'admin');
update public.player_pools set rankings_approved_at=null;
insert into public.fantasy_seasons(id,label,rule_version,status,trade_deadline)
select pg_temp.e_id(key),label,'test','active',now()+interval '500 days'
from(values('current','Explorer current'),('past','Explorer past'),('future','Explorer future'))t(key,label);
insert into public.fantasy_periods(id,season_id,number,starts_at,ends_at,phase)
select pg_temp.e_id(key||'-period'),pg_temp.e_id(key),1,now()+days*interval '1 day',now()+(days+7)*interval '1 day','regular'
from(values('current',-30),('past',-400),('future',40))t(key,days);
insert into public.player_pools(id,season_id,name,ruleset_id,is_active,rankings_approved_at)
select pg_temp.e_id(key||'-pool'),pg_temp.e_id(key),key,'b0000000-0000-4000-8000-000000000001',true,now()
from unnest(array['current','past','future'])key;
insert into public.leagues(id,pool_id,commissioner_id,ruleset_id,name,format,status,max_members,invite_code,created_at)
select pg_temp.e_id('league-'||n),pg_temp.e_id('current-pool'),pg_temp.e_id('admin'),'b0000000-0000-4000-8000-000000000001',
  case when n=1 then 'Needle League' else 'Explorer League '||n end,'head_to_head','setup',4,'EX'||lpad(n::text,10,'0'),now()
from generate_series(1,30)n;
insert into public.leagues(id,pool_id,commissioner_id,ruleset_id,name,format,status,max_members,invite_code)
select pg_temp.e_id(season||'-'||status),pg_temp.e_id(season||'-pool'),pg_temp.e_id('admin'),'b0000000-0000-4000-8000-000000000001',
  season||' '||status,'head_to_head',status::public.league_status,4,substr(md5(season||status),1,12)
from(values('current','drafting'),('current','active'),('current','complete'),('current','archived'),
  ('past','setup'),('past','drafting'),('past','active'),('past','complete'),('past','archived'),('future','setup'))t(season,status);
insert into public.league_members(league_id,user_id,role)values
  (pg_temp.e_id('league-1'),pg_temp.e_id('admin'),'commissioner'),(pg_temp.e_id('league-1'),pg_temp.e_id('member'),'member');
insert into public.fantasy_teams(id,league_id,owner_id,name)values
  (pg_temp.e_id('team'),pg_temp.e_id('league-1'),pg_temp.e_id('admin'),'Searchable Badgers'),
  (pg_temp.e_id('empty-team'),pg_temp.e_id('league-1'),pg_temp.e_id('member'),'Empty Roster');
insert into public.sports(code,name)values('hockey','Hockey')on conflict(code)do nothing;
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id)
select pg_temp.e_id('competition'),id,'mens','Explorer hockey','Explorer current','b0000000-0000-4000-8000-000000000001'from public.sports where code='hockey';
insert into public.teams(id,competition_id,name,short_name)values(pg_temp.e_id('program-team'),pg_temp.e_id('competition'),'Explorer program','EXP');
insert into public.athletes(id,competition_id,team_id,display_name,position)
select pg_temp.e_id(key),pg_temp.e_id('competition'),pg_temp.e_id('program-team'),key,'F'from unnest(array['current-athlete','released-athlete'])key;
insert into public.roster_entries(id,league_id,fantasy_team_id,athlete_id,slot_code,status,acquisition_type,released_at)
select pg_temp.e_id(key||'-roster'),pg_temp.e_id('league-1'),pg_temp.e_id('team'),pg_temp.e_id(key),'HK_F','starter','draft',case when key='released-athlete'then now()end
from unnest(array['current-athlete','released-athlete'])key;
insert into public.chat_messages(id,league_id,author_id,body,created_at,hidden_at)
select pg_temp.e_id('message-'||n),pg_temp.e_id('league-1'),pg_temp.e_id('member'),'Message '||n,now(),case when n=1 then now() end from generate_series(1,121)n;
insert into public.chat_mutes(league_id,user_id,muted_user_id)values(pg_temp.e_id('league-1'),pg_temp.e_id('admin'),pg_temp.e_id('member'));

select ok(not has_function_privilege('anon','public.admin_get_league_summary()','execute'),'anonymous clients cannot read the tracker');
select ok(not has_function_privilege('authenticated','beta_private.league_view_catalog()','execute'),'clients cannot read the unguarded catalog');
select ok(not (select prosecdef from pg_proc where oid='public.admin_get_league_chat(uuid,timestamptz,uuid)'::regprocedure),'chat API is an invoker wrapper');
select ok((select provolatile='s' from pg_proc where oid='rpc_private.admin_get_league_section(uuid,text)'::regprocedure),'section reads cannot perform writes');
select set_config('request.jwt.claim.sub',pg_temp.e_id('member')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.e_id('member'),'role','authenticated','aal','aal2','session_id',pg_temp.e_id('member'))::text,true);
set local role authenticated;
select throws_ok($$select public.admin_get_league_summary()$$,'42501',null,'ordinary members cannot read league counts');
select throws_ok($$select public.admin_list_leagues()$$,'42501',null,'ordinary members cannot search all leagues');
select throws_ok($$select public.admin_get_league_section(pg_temp.e_id('league-1'),'members')$$,'42501',null,'ordinary members cannot inspect contact details');
select throws_ok($$select public.admin_get_league_roster(pg_temp.e_id('league-1'),pg_temp.e_id('team'))$$,'42501',null,'ordinary members cannot call admin roster reads');
select throws_ok($$select public.admin_get_league_chat(pg_temp.e_id('league-1'))$$,'42501',null,'ordinary members cannot read hidden chat');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.e_id('admin')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.e_id('admin'),'role','authenticated','aal','aal1','session_id',pg_temp.e_id('admin'))::text,true);
set local role authenticated;
select throws_ok($$select public.admin_get_league_summary()$$,'42501','Administrator MFA required','admin without MFA is denied');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.e_id('admin'),'role','authenticated','aal','aal2','session_id',pg_temp.e_id('admin'))::text,true);
set local role authenticated;
select is(public.admin_get_league_summary()->>'currentSeasonLabel','Explorer current','future publication cannot replace the season underway');
select is((public.admin_get_league_summary()->>'openCount')::int,32,'tracker counts only current open registrations');
create temp table first_page as select public.admin_list_leagues() result;
select is(jsonb_array_length((select result->'items' from first_page)),25,'directory reads 25 leagues');
select is((select (result->>'hasMore')::boolean from first_page),true,'directory exposes next page');
create temp table second_page as select public.admin_list_leagues('current','open','',
  ((select result->'nextCursor'->>'at' from first_page))::timestamptz,((select result->'nextCursor'->>'id' from first_page))::uuid) result;
select is(jsonb_array_length((select result->'items' from second_page)),7,'next page finishes the open count');
select is((select count(distinct item->>'id') from (
  select jsonb_array_elements(result->'items') item from first_page union all select jsonb_array_elements(result->'items') from second_page)t),32::bigint,'equal timestamps neither skip nor duplicate leagues');
select is(jsonb_array_length(public.admin_list_leagues('previous','all')->'items'),5,'previous includes every prior status and excludes future leagues');
select is(jsonb_array_length(public.admin_list_leagues('previous','open')->'items'),3,'previous defaults can restrict to open leagues');
select is(jsonb_array_length(public.admin_list_leagues('Explorer future','all')->'items'),1,'individual season filter can inspect future registrations');
select is(jsonb_array_length(public.admin_list_leagues('current','complete')->'items'),1,'completed filter');
select is(jsonb_array_length(public.admin_list_leagues('current','archived')->'items'),1,'archived filter');
select is(jsonb_array_length(public.admin_list_leagues('current','drafting')->'items'),1,'drafting filter');
select is(jsonb_array_length(public.admin_list_leagues('current','active')->'items'),1,'active filter');
select is(jsonb_array_length(public.admin_list_leagues('current','open','needle')->'items'),1,'league name search');
select is(jsonb_array_length(public.admin_list_leagues('all','all',pg_temp.e_id('league-1')::text)->'items'),1,'league ID search');
select is(jsonb_array_length(public.admin_list_leagues('all','all','searchable badgers')->'items'),1,'team name search');
select is(jsonb_array_length(public.admin_list_leagues('all','all','distinct member')->'items'),1,'member name search');
select is(jsonb_array_length(public.admin_list_leagues('all','all','EXPLORER-MEMBER@example.test')->'items'),1,'member email search is case insensitive');
select is(jsonb_array_length(public.admin_list_leagues('all','all','%')->'items'),0,'wildcards are treated literally');
select throws_ok($$select public.admin_list_leagues('current','invalid')$$,'22023','Invalid league filters','invalid status is rejected');
select is((select item->>'email' from jsonb_array_elements(public.admin_get_league_section(pg_temp.e_id('league-1'),'members')->'items')item
  where item->>'user_id'=pg_temp.e_id('member')::text),'explorer-member@example.test','MFA admin can inspect member email');
select is(public.admin_get_league_section(pg_temp.e_id('league-1'),'overview')->'league'->>'draft_status',null::text,'league without draft remains inspectable');
select is(jsonb_array_length(public.admin_get_league_section(pg_temp.e_id('league-1'),'matchups')->'items'),0,'unscheduled league has empty matchups');
select is(jsonb_array_length(public.admin_get_league_section(pg_temp.e_id('league-1'),'standings')->'items'),2,'existing standings calculations are reused');
select is(jsonb_array_length(public.admin_get_league_roster(pg_temp.e_id('league-1'),pg_temp.e_id('empty-team'))),0,'empty saved roster is valid');
select is(jsonb_array_length(public.admin_get_league_roster(pg_temp.e_id('league-1'),pg_temp.e_id('team'))),1,'roster excludes released athletes');
select is(public.admin_get_league_roster(pg_temp.e_id('league-1'),pg_temp.e_id('team'))->0->>'status','starter','roster preserves saved starter assignment');
select throws_ok($$select public.admin_get_league_roster(pg_temp.e_id('league-2'),pg_temp.e_id('team'))$$,'P0002','Team unavailable in this league','roster selection is scoped to the league');
select throws_ok($$select public.admin_get_league_section(pg_temp.e_id('missing'))$$,'P0002','League unavailable','missing league is explicit');
create temp table chat_one as select public.admin_get_league_chat(pg_temp.e_id('league-1')) result;
create temp table chat_two as select public.admin_get_league_chat(pg_temp.e_id('league-1'),
  ((select result->'nextCursor'->>'at' from chat_one))::timestamptz,((select result->'nextCursor'->>'id' from chat_one))::uuid) result;
create temp table chat_three as select public.admin_get_league_chat(pg_temp.e_id('league-1'),
  ((select result->'nextCursor'->>'at' from chat_two))::timestamptz,((select result->'nextCursor'->>'id' from chat_two))::uuid) result;
select is(jsonb_array_length((select result->'items' from chat_one)),50,'initial chat is bounded to 50 despite personal mute');
select is(jsonb_array_length((select result->'items' from chat_three)),21,'older chat is fully reachable');
select is((select count(distinct item->>'id') from (select jsonb_array_elements(result->'items') item from chat_one union all
  select jsonb_array_elements(result->'items') from chat_two union all select jsonb_array_elements(result->'items') from chat_three)t),121::bigint,'same-timestamp chat pages have no gaps or duplicates');
select is((select count(*) from (select jsonb_array_elements(result->'items') item from chat_one union all
  select jsonb_array_elements(result->'items') from chat_two union all select jsonb_array_elements(result->'items') from chat_three)t where item->>'hidden_at' is not null),1::bigint,'hidden messages are labelled and retained');
reset role;
create temp table before_state as select jsonb_build_object('members',(select jsonb_agg(to_jsonb(t))from public.league_members t),
  'teams',(select jsonb_agg(to_jsonb(t))from public.fantasy_teams t),'leagues',(select jsonb_agg(to_jsonb(t))from public.leagues t),
  'chat',(select jsonb_agg(to_jsonb(t))from public.chat_messages t),'drafts',(select jsonb_agg(to_jsonb(t))from public.drafts t),
  'rosters',(select jsonb_agg(to_jsonb(t))from public.roster_entries t),'matchups',(select jsonb_agg(to_jsonb(t))from public.matchups t)) value;
set local role authenticated;
select lives_ok($$select public.admin_get_league_summary()$$,'summary read completes');
select lives_ok($$select public.admin_list_leagues()$$,'directory read completes');
select lives_ok(format('select public.admin_get_league_section(%L,%L)',pg_temp.e_id('league-1'),section),'section read completes: '||section)
  from unnest(array['overview','members','rosters','standings','matchups','chat'])section;
select lives_ok($$select public.admin_get_league_roster(pg_temp.e_id('league-1'),pg_temp.e_id('team'))$$,'roster read completes');
select lives_ok($$select public.admin_get_league_chat(pg_temp.e_id('league-1'))$$,'chat read completes');
reset role;
select is(jsonb_build_object('members',(select jsonb_agg(to_jsonb(t))from public.league_members t),
  'teams',(select jsonb_agg(to_jsonb(t))from public.fantasy_teams t),'leagues',(select jsonb_agg(to_jsonb(t))from public.leagues t),
  'chat',(select jsonb_agg(to_jsonb(t))from public.chat_messages t),'drafts',(select jsonb_agg(to_jsonb(t))from public.drafts t),
  'rosters',(select jsonb_agg(to_jsonb(t))from public.roster_entries t),'matchups',(select jsonb_agg(to_jsonb(t))from public.matchups t)),
  (select value from before_state),'all explorer reads preserve league state even for the commissioner and team owner');
update public.player_pools set is_active=false where season_id=pg_temp.e_id('current');
select is(beta_private.league_view_current_season(),pg_temp.e_id('current'),'off-season retains the last started published season even after pool deactivation');
update public.fantasy_periods set starts_at=now()-interval '1 day',ends_at=now()+interval '6 days' where season_id=pg_temp.e_id('future');
select is(beta_private.league_view_current_season(),pg_temp.e_id('future'),'new season takes over when its calendar begins');
update public.fantasy_periods set starts_at=now()+interval '10 days',ends_at=now()+interval '17 days';
set local role authenticated;
select is(public.admin_get_league_summary()->>'currentSeasonLabel',null::text,'no started season is explicit');
select is((public.admin_get_league_summary()->>'openCount')::int,0,'no started season gives zero registrations');
select is(jsonb_array_length(public.admin_list_leagues()->'items'),0,'no current season gives an empty current directory');
reset role;
-- - Inspect actual access plans on a representative directory without disabling sequential scans
insert into public.competitions(id,sport_id,division,name,season_label,ruleset_id)
select pg_temp.e_id('legacy-competition'),id,'mens','Legacy hockey','Unmapped legacy season','b0000000-0000-4000-8000-000000000001'from public.sports where code='hockey';
insert into public.leagues(id,competition_id,commissioner_id,ruleset_id,name,format,max_members,invite_code)
values(pg_temp.e_id('legacy-current'),pg_temp.e_id('competition'),pg_temp.e_id('admin'),'b0000000-0000-4000-8000-000000000001','Legacy current league','head_to_head',8,'LEGACY000001'),
  (pg_temp.e_id('legacy-unmapped'),pg_temp.e_id('legacy-competition'),pg_temp.e_id('admin'),'b0000000-0000-4000-8000-000000000001','Legacy unmatched league','head_to_head',8,'LEGACY000002');
update public.fantasy_periods set starts_at=now()-interval '30 days',ends_at=now()-interval '23 days'where season_id=pg_temp.e_id('current');
set local role authenticated;
select is((public.admin_get_league_summary()->>'openCount')::int,33,'legacy competition season label contributes to the current tracker');
select is(jsonb_array_length(public.admin_list_leagues('all','all','Legacy unmatched league')->'items'),1,'unmapped legacy leagues remain discoverable in All seasons');
select is(jsonb_array_length(public.admin_list_leagues('Unmapped legacy season','all')->'items'),1,'legacy season labels have their own filter');
reset role;
update public.profiles set deleted_at=now()where id=pg_temp.e_id('member');
set local role authenticated;
select is((select item->>'display_name'from jsonb_array_elements(public.admin_get_league_section(pg_temp.e_id('league-1'),'members')->'items')item
  where item->>'user_id'=pg_temp.e_id('member')::text),'Unavailable account','unavailable accounts use a placeholder');
select is((select item->>'email'from jsonb_array_elements(public.admin_get_league_section(pg_temp.e_id('league-1'),'members')->'items')item
  where item->>'user_id'=pg_temp.e_id('member')::text),null::text,'unavailable accounts do not expose old email');
select is(public.admin_get_league_chat(pg_temp.e_id('league-1'))->'items'->0->>'author','Unavailable account','unavailable chat authors use a placeholder');
reset role;
insert into public.leagues(id,pool_id,commissioner_id,ruleset_id,name,format,max_members,invite_code,created_at)
select pg_temp.e_id('performance-'||n),pg_temp.e_id('current-pool'),pg_temp.e_id('admin'),'b0000000-0000-4000-8000-000000000001',
  case when n=1 then 'Unique indexed needle'else 'Performance league '||n end,'head_to_head',4,substr(md5('performance-'||n),1,12),now()-n*interval '1 minute'
from generate_series(1,5000)n;
select lives_ok($$select pg_catalog.gin_clean_pending_list('public.leagues_admin_name')$$,'flush bulk fixture pending entries as autovacuum would');
analyze public.leagues;
create function pg_temp.explorer_plan(query text)returns text language plpgsql as $$declare result json;begin
  execute 'explain(analyze,buffers,format json) '||query into result;return result::text;end;$$;
select ok(position('leagues_admin_created' in pg_temp.explorer_plan($$select id from public.leagues
  where(created_at,id)<(now(),'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)order by created_at desc,id desc limit 25$$))>0,'keyset pagination uses the ordered index');
select ok(position('leagues_admin_name' in pg_temp.explorer_plan($$select id from public.leagues where lower(name)like '%unique indexed needle%'$$))>0,'substring search uses the trigram index');
select * from finish();
rollback;
