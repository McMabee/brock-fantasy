set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Bound each minute's work and keep both candidate scans independent of finalized history
create index if not exists matchups_scheduled_start on public.matchups(starts_at,id) where status='scheduled';
create index if not exists matchups_unfinalized_end on public.matchups(ends_at,id) where status in('scheduled','active');

create or replace function public.advance_matchup_periods(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_activated integer := 0;
  v_finalized integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Invalid processing limit'; end if;
  with candidates as (
    select id from public.matchups
    where status='scheduled' and starts_at<=now() and ends_at>now()
    order by starts_at,id limit p_limit for update skip locked
  )
  update public.matchups m set status='active'
  from candidates c where m.id=c.id;
  get diagnostics v_activated = row_count;

  -- - Catch up every expired period while preserving published totals and finalized results
  -- - Pool leagues wait for all scoring competitions and complete administrative stat publication
  -- - Legacy leagues retain their existing game-status safeguard
  with candidates as (
    select m.id from public.matchups m
    join public.leagues l on l.id=m.league_id
    where m.status in('scheduled','active') and m.ends_at<=now()
      and not exists (
        select 1 from public.games g
        where g.starts_at>=m.starts_at and g.starts_at<m.ends_at
          and (
            (l.pool_id is null and g.competition_id=l.competition_id
              and g.status not in('final','cancelled','postponed'))
            or (l.pool_id is not null and g.schedule_kind in('regular','playoff')
              and exists(select 1 from public.pool_competitions pc where pc.pool_id=l.pool_id and pc.competition_id=g.competition_id)
              and (g.status not in('final','cancelled','postponed') or (g.status='final' and not g.stats_complete)))
          )
      )
    order by m.ends_at,m.id limit p_limit for update of m skip locked
  )
  update public.matchups m set status='final',finalized_at=now()
  from candidates c where m.id=c.id;
  get diagnostics v_finalized = row_count;
  return jsonb_build_object('activated',v_activated,'finalized',v_finalized);
end;
$$;

revoke all on function public.advance_matchup_periods(integer) from public,anon,authenticated,service_role;
grant execute on function public.advance_matchup_periods(integer) to service_role;

-- - Refuse a competing database schedule rather than silently creating a second worker
do $$ begin
  if exists(select 1 from cron.job where jobname is distinct from 'brock-matchup-rollover' and command~*'\madvance_matchup_periods\s*\(') then
    raise exception 'Existing matchup rollover job found; reconcile it before installing brock-matchup-rollover';
  end if;
end $$;

-- - Named registration updates the existing job on replay instead of accumulating duplicates
-- - Every minute compares stored absolute timestamps without assuming a fixed Toronto UTC offset
select cron.schedule('brock-matchup-rollover','* * * * *','select public.advance_matchup_periods(1000);');
