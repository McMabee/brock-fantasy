-- - Activate operator-approved draft features separately from email and retention
-- - Preserve existing leagues, committed picks, scoring holds, and access controls
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $activation$
declare previous jsonb; current_controls jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('release-activation-20261029',0));
  select to_jsonb(c) into strict previous from beta_private.release_controls c for update;
  if exists(select 1 from public.leagues where draft_mode='scheduled_auto'
    and status='setup' and draft_setup_state::text in('armed','running')) then
    raise exception 'Review existing automatic draft commitments before activation';
  end if;
  update beta_private.release_controls set automatic_drafts_enabled=true,
    mode_selection_required=true,fresh_command_keys_required=true where singleton;
  select to_jsonb(c) into strict current_controls from beta_private.release_controls c;
  if previous is distinct from current_controls then
    perform beta_private.audit('release.controls_enabled','release_controls','singleton',previous,
      current_controls||jsonb_build_object('reason','Operator reported acceptance passed and requested activation'),
      'release-activation-20261029-drafts');
  end if;
end;
$activation$;
commit;
select jsonb_build_object('controls',(select to_jsonb(c) from beta_private.release_controls c),
  'completedDrafts',(select count(*) from public.drafts where status='complete'),
  'draftPicks',(select count(*) from public.draft_picks),
  'pointEvents',(select count(*) from public.fantasy_point_events)) as evidence;
