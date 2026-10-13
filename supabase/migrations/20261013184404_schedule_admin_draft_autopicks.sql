-- The existing worker permits database cron sessions and restores its temporary
-- worker claim after every batch. No HTTP endpoint or stored credential is used.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'brock-draft-autopick',
  '15 seconds',
  'select public.process_expired_drafts(25);'
);

-- Retain seven days of this job's history without accumulating idle ticks.
select cron.schedule(
  'brock-draft-autopick-history',
  '17 4 * * *',
  $$delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'brock-draft-autopick')
      and end_time < now() - interval '7 days';$$
);
