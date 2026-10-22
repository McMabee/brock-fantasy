begin;
select plan(5);
select is((select count(*)::integer from pg_proc where pronamespace='public'::regnamespace
  and proname='set_draft_status'),1,'JSON callers resolve exactly one public draft status function');
select has_function('public','set_draft_status',array['uuid','text','text'],'the existing text RPC contract remains');
select ok(to_regprocedure('public.set_draft_status(uuid,public.draft_status,text)') is null,
  'the conflicting public enum overload is retired');
select ok(to_regprocedure('rpc_private.set_draft_status(uuid,public.draft_status,text)') is not null
  and position('rpc_private.set_draft_status' in pg_get_functiondef('rpc_private.set_draft_status(uuid,text,text)'::regprocedure))>0,
  'the text adapter delegates directly to the retained private enum implementation');
-- - Exercise reset drafts and commissioner controls using isolated rollback fixtures
create function pg_temp.resume_id(text) returns uuid language sql immutable as $$ select md5('draft-resume:'||$1)::uuid; $$;
insert into auth.users(id,email,email_confirmed_at,created_at,raw_user_meta_data)
select pg_temp.resume_id('user'||n),'draft-resume-'||n||'@example.test',now(),now(),
  jsonb_build_object('display_name','Draft resume fixture','varsity_role','none','varsity_programs','[]'::jsonb,
    'beta_age_eligible',true,'beta_eligibility_year',extract(year from timezone('America/Toronto',now()))::int,
    'beta_eligibility_policy_version','brock-beta-eligibility-2026-10-06.1') from generate_series(1,2)n;
insert into auth.sessions(id,user_id,aal)
select pg_temp.resume_id('user'||n),pg_temp.resume_id('user'||n),'aal1' from generate_series(1,2)n;
insert into public.leagues(id,pool_id,ruleset_id,commissioner_id,name,invite_code,max_members,format,status)
values(pg_temp.resume_id('league'),'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004',
  pg_temp.resume_id('user1'),'Draft resume fixture',gen_random_uuid(),4,'head_to_head','drafting');
insert into public.league_members(league_id,user_id,role)
select pg_temp.resume_id('league'),pg_temp.resume_id('user'||n),
  case when n=1 then 'commissioner'::public.league_member_role else 'member'::public.league_member_role end from generate_series(1,2)n;
insert into public.fantasy_teams(id,league_id,owner_id,name,draft_position)
select pg_temp.resume_id('team'||n),pg_temp.resume_id('league'),pg_temp.resume_id('user'||n),'Resume team '||n,n from generate_series(1,2)n;
insert into public.drafts(id,league_id,status,rounds,pick_seconds,team_order,remaining_seconds,voided_at)
select pg_temp.resume_id(label),pg_temp.resume_id('league'),'paused',10,90,
  array[pg_temp.resume_id('team1'),pg_temp.resume_id('team2')],null,
  case when label='old' then now() end from unnest(array['old','current'])label;
select set_config('request.jwt.claim.sub',pg_temp.resume_id('user1')::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.resume_id('user1'),'role','authenticated','aal','aal1','session_id',pg_temp.resume_id('user1'))::text,true);
set local role authenticated;
do $$
declare snap jsonb; response jsonb; version bigint;
begin
  assert (select count(*) from public.drafts where league_id=pg_temp.resume_id('league'))=2,'Reset fixture must include both drafts';
  assert (select count(*) from public.drafts where league_id=pg_temp.resume_id('league') and voided_at is null)=1,'Exactly one draft is current';
  snap:=public.get_draft_room_snapshot(pg_temp.resume_id('current'));
  assert snap->'league'->>'commissioner_id'=pg_temp.resume_id('user1')::text,'Snapshot identifies the commissioner';
  snap:=public.get_draft_room_snapshot(pg_temp.resume_id('old'));
  assert (snap->>'closed')::boolean and (snap->>'replaced')::boolean,'Archived draft redirects out of the draft room';
  begin
    perform public.set_draft_status(pg_temp.resume_id('old'),'active','resume-old-fixture');
    raise exception 'Archived draft unexpectedly resumed';
  exception when invalid_parameter_value then null;
  end;
  response:=public.set_draft_status(pg_temp.resume_id('current'),'active','resume-current-fixture');
  assert response->>'status'='active','Commissioner can resume';
  assert (select starts_at is not null and pick_deadline between clock_timestamp()+interval '85 seconds' and clock_timestamp()+interval '91 seconds'
    from public.drafts where id=pg_temp.resume_id('current')),'Resume starts the saved 90 second clock';
  select state_version into version from public.drafts where id=pg_temp.resume_id('current');
  assert public.set_draft_status(pg_temp.resume_id('current'),'active','resume-current-fixture')=response,'Retries return the original response';
  assert (select state_version from public.drafts where id=pg_temp.resume_id('current'))=version,'Retry does not restart the clock';
  perform public.set_draft_status(pg_temp.resume_id('current'),'paused','pause-current-fixture');
  assert (select status='paused' and pick_deadline is null and remaining_seconds between 85 and 90 from public.drafts where id=pg_temp.resume_id('current')),'Pause freezes the remaining clock';
  perform set_config('request.jwt.claim.sub',pg_temp.resume_id('user2')::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.resume_id('user2'),'role','authenticated','aal','aal1','session_id',pg_temp.resume_id('user2'))::text,true);
  begin
    perform public.set_draft_status(pg_temp.resume_id('current'),'active','resume-member-fixture');
    raise exception 'Ordinary member unexpectedly resumed';
  exception when raise_exception then
    if sqlerrm<>'Commissioner access required' then raise; end if;
  end;
  assert (select current_overall_pick=1 and status='paused' from public.drafts where id=pg_temp.resume_id('current')),'Member cannot change draft state';
end $$;
reset role;
select pass('Reset selection, snapshot, resume, retry, pause and commissioner authorization');
select * from finish();
rollback;
