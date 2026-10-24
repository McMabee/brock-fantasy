set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Admit late drafts while their approved regular-season calendar still has a scoring window
-- - Match automatic scheduling cutoffs and the seven-period limit for eight-manager leagues
create function beta_private.has_draft_window(p_pool_id uuid,p_managers integer,p_at timestamptz)
returns boolean language sql stable strict security invoker set search_path='' as $$
select p_managers in(4,6,8,10) and exists(
  select 1 from (
    select f.* from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
    where p.id=p_pool_id and f.phase='regular' order by f.number
    limit case when p_managers=8 then 7 else 8 end
  )f
  where p_at<coalesce((
    select min(g.lineup_lock_at) from public.pool_competitions pc join public.games g on g.competition_id=pc.competition_id
    where pc.pool_id=p_pool_id and g.starts_at>=f.starts_at and g.starts_at<f.ends_at
      and g.status not in('cancelled','postponed') and g.schedule_kind in('regular','playoff')
  ),f.starts_at)
);
$$;
revoke all on function beta_private.has_draft_window(uuid,integer,timestamptz) from public,anon,authenticated,service_role;

-- - Replace only the obsolete preseason predicates while retaining all existing command checks
do $migration$
declare definition text;
  start_guard text:='if now()>=(select min(starts_at) from public.fantasy_periods where season_id=p.season_id) then raise exception ''The season has started''; end if;';
  schedule_guard text:='p_scheduled_for>=(select min(fp.starts_at) from public.fantasy_periods fp join public.player_pools pool on pool.season_id=fp.season_id where pool.id=l.pool_id)';
begin
  select pg_get_functiondef('rpc_private.start_draft(uuid,integer,integer,text)'::regprocedure) into definition;
  if position(start_guard in definition)=0 then raise exception 'Reviewed draft-start guard changed'; end if;
  execute replace(definition,start_guard,
    'if not beta_private.has_draft_window(l.pool_id,l.max_members,clock_timestamp()) then raise exception ''No eligible regular-season periods remain for a new draft'' using errcode=''22023''; end if;');

  select pg_get_functiondef('rpc_private.schedule_league_draft(uuid,timestamptz,bigint,text)'::regprocedure) into definition;
  if position(schedule_guard in definition)=0 then raise exception 'Reviewed draft-scheduling guard changed'; end if;
  execute replace(replace(definition,schedule_guard,
    'not beta_private.has_draft_window(l.pool_id,l.max_members,p_scheduled_for)'),
    'Choose a future date before the season starts','Choose a future date while an eligible regular-season period remains');
end;
$migration$;

notify pgrst,'reload schema';
