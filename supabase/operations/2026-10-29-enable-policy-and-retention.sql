-- - Record the operator's completed policy and retention reviews
-- - Run one bounded disposal batch after fresh backup, restore, and replay acceptance
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local request.jwt.claims='{"role":"service_role"}';
do $activation$
declare previous jsonb; current_controls jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('release-activation-20261029',0));
  select to_jsonb(c) into strict previous from beta_private.release_controls c for update;
  if not(previous->>'fresh_command_keys_required')::boolean then
    raise exception 'Enable fresh command intents before receipt disposal';
  end if;
  update beta_private.release_controls set policy_publication_approved=true,retention_enabled=true where singleton;
  select to_jsonb(c) into strict current_controls from beta_private.release_controls c;
  if previous is distinct from current_controls then
    perform beta_private.audit('release.controls_enabled','release_controls','singleton',previous,
      current_controls||jsonb_build_object('reason','Operator explicitly confirmed policy, source-rights, and retention inventory reviews complete'),
      'release-activation-20261029-retention');
  end if;
end;
$activation$;
select beta_private.process_retention(100) as retention_result;
commit;
select jsonb_build_object('policyApproved',policy_publication_approved,'retentionEnabled',retention_enabled)
  as evidence from beta_private.release_controls;
