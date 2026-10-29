-- - Rehearse hosted reads using existing database identities without changing accounts or application data
-- - Database-role claims do not substitute for the signed-in browser and genuine MFA journey
begin isolation level repeatable read;
set local statement_timeout='30s';
set local lock_timeout='2s';
create temp table centre_release_evidence(item text primary key,value jsonb);
grant select,insert on centre_release_evidence to authenticated;
create function pg_temp.centre_release_actor(p_admin boolean,p_aal text default 'aal2') returns void language plpgsql as $$
declare selected_user uuid;selected_session uuid;
begin
  select p.id,s.id into selected_user,selected_session from public.profiles p
  join auth.users u on u.id=p.id and u.email_confirmed_at is not null
  join auth.sessions s on s.user_id=p.id
  where p.deleted_at is null and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='admin')=p_admin
    and(not p_admin or s.aal='aal2') order by s.created_at desc limit 1;
  if selected_user is null then raise exception 'A current account and session are required for hosted read acceptance';end if;
  perform set_config('request.jwt.claim.sub',selected_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',selected_user,'session_id',selected_session,'role','authenticated','aal',p_aal)::text,true);
end;$$;
do $$begin perform pg_temp.centre_release_actor(true);end;$$;
set local role authenticated;
do $$declare summary jsonb;page jsonb;seasons jsonb;ranking jsonb;preview jsonb;season text;begin
  summary:=public.admin_get_operations_summary();
  if jsonb_array_length(summary->'auditEvents')>40 then raise exception 'Dashboard audit bound failed';end if;
  perform public.admin_get_operations('runs','player');
  perform public.admin_get_operations('runs','schedule');
  perform public.admin_get_operations('alerts',p_status=>'unresolved');
  perform public.admin_get_operations('audit');
  page:=public.admin_list_leagues_filtered();
  insert into centre_release_evidence values('operations',jsonb_build_object('recentAuditEvents',jsonb_array_length(summary->'auditEvents'),'recentRuns',jsonb_array_length(summary->'syncRows'),'unresolvedAlerts',summary->'unresolvedErrors'));
  insert into centre_release_evidence values('leagues',jsonb_build_object('matching',page->'filteredCount','total',page->'totalCount'));
  seasons:=public.admin_get_ranking_seasons();
  ranking:=public.admin_get_ranking_review();
  preview:=public.admin_get_ranking_review(p_preview=>true);
  if jsonb_array_length(ranking->'rows')=0 or jsonb_array_length(preview->'rows')=0 then raise exception 'Current published rankings or approved preview inputs are unavailable';end if;
  for season in select jsonb_array_elements_text(seasons->'seasons') loop
    if season<>seasons->>'currentSeason' then
      if(public.admin_get_ranking_review(season)->>'canPublish')::boolean then raise exception 'Historical publication unexpectedly allowed';end if;
    end if;
  end loop;
  insert into centre_release_evidence values('rankings',jsonb_build_object('season',seasons->'currentSeason','publishedAthletes',jsonb_array_length(ranking->'rows'),'previewAthletes',jsonb_array_length(preview->'rows'),'publication',ranking->'publication'));
  perform public.admin_list_participant_requests();
  perform public.admin_get_participant_scan();
end;$$;
reset role;
do $$begin perform pg_temp.centre_release_actor(true,'aal1');end;$$;
set local role authenticated;
do $$begin
  begin perform public.admin_get_operations_summary();raise exception 'Admin operations allowed without MFA';exception when insufficient_privilege then null;end;
  begin perform public.admin_list_leagues_filtered();raise exception 'League filtering allowed without MFA';exception when insufficient_privilege then null;end;
  begin perform public.admin_get_ranking_seasons();raise exception 'Ranking seasons allowed without MFA';exception when insufficient_privilege then null;end;
  begin perform public.admin_get_ranking_review();raise exception 'Ranking review allowed without MFA';exception when insufficient_privilege then null;end;
  begin perform public.admin_list_participant_requests();raise exception 'Participant requests allowed without MFA';exception when insufficient_privilege then null;end;
end;$$;
reset role;
do $$begin perform pg_temp.centre_release_actor(false,'aal1');end;$$;
set local role authenticated;
do $$begin
  begin perform public.admin_get_operations_summary();raise exception 'Member operations access allowed';exception when insufficient_privilege then null;end;
  begin perform public.admin_get_ranking_review();raise exception 'Member ranking review allowed';exception when insufficient_privilege then null;end;
end;$$;
reset role;
insert into centre_release_evidence values('boundaries',jsonb_build_object('adminAal1Denied',true,'memberDenied',true,'confirmationEnabled',(select participant_confirmation_enabled from beta_private.release_controls)));
select jsonb_object_agg(item,value) as evidence from centre_release_evidence;
rollback;
