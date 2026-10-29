-- - Enable administrator-requested confirmations after real signed delivery acceptance
-- - Leave recipient ownership, MFA, review concurrency, and scan evidence checks intact
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $activation$
declare previous jsonb; current_controls jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('release-activation-20261029',0));
  select to_jsonb(c) into strict previous from beta_private.release_controls c for update;
  if not(previous->>'service_email_enabled')::boolean then
    raise exception 'Enable the configured email service before confirmations';
  end if;
  if not exists(select 1 from beta_private.service_email_jobs j
    join beta_private.service_email_events e on e.provider_id=j.provider_id and e.event='delivered'
    where j.dedupe_key='release-email-test-20261029' and j.status='delivered') then
    raise exception 'Verify real delivery and signed provider events before confirmations';
  end if;
  update beta_private.release_controls set participant_confirmation_enabled=true where singleton;
  select to_jsonb(c) into strict current_controls from beta_private.release_controls c;
  if previous is distinct from current_controls then
    perform beta_private.audit('release.controls_enabled','release_controls','singleton',previous,
      current_controls||jsonb_build_object('reason','Operator requested activation and confirmed controlled inbox delivery and sign-in navigation'),
      'release-activation-20261029-confirmations');
  end if;
end;
$activation$;
commit;
select participant_confirmation_enabled from beta_private.release_controls;
