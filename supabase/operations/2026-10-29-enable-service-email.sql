-- - Enable the configured outbox after authenticated hosted worker acceptance
-- - Preserve independent participant, policy, and retention release controls
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $activation$
declare previous jsonb; current_controls jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('release-activation-20261029',0));
  select to_jsonb(c) into strict previous from beta_private.release_controls c for update;
  if not exists(select 1 from vault.decrypted_secrets where name='brock_service_email_worker_url'
    and decrypted_secret='https://play.brockfantasy.ca/api/service-email/worker')
    or not exists(select 1 from vault.decrypted_secrets where name='brock_service_email_worker_secret'
      and length(decrypted_secret)>=32) then
    raise exception 'Configure the canonical dispatcher before enabling service email';
  end if;
  update beta_private.release_controls set service_email_enabled=true where singleton;
  select to_jsonb(c) into strict current_controls from beta_private.release_controls c;
  if previous is distinct from current_controls then
    perform beta_private.audit('release.controls_enabled','release_controls','singleton',previous,
      current_controls||jsonb_build_object('reason','Operator requested activation and selected a controlled acceptance inbox'),
      'release-activation-20261029-email');
  end if;
end;
$activation$;
commit;
select service_email_enabled from beta_private.release_controls;
