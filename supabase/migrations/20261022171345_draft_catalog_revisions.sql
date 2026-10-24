set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Advance each affected catalog once per statement using transition tables
-- - Include old identities so reassignment and cascading deletion invalidate both sides
create or replace function beta_private.invalidate_draft_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source text; lookup text; affected uuid[]; pool uuid;
begin
  source := case tg_op when 'INSERT' then 'new_rows' when 'DELETE' then 'old_rows'
    else '(select * from old_rows union all select * from new_rows)' end;
  case tg_table_name
    when 'pool_rankings', 'pool_competitions' then
      lookup := 'select pool_id from %s c';
    when 'athlete_seasons' then
      lookup := 'select p.id from %s c join public.player_pools p on p.season_id=c.season_id
        join public.pool_competitions pc on pc.pool_id=p.id and pc.competition_id=c.competition_id';
    when 'athletes' then
      lookup := 'select pc.pool_id from %1$s c join public.pool_competitions pc on pc.competition_id=c.competition_id
        union select p.id from %1$s c join public.athlete_seasons m on m.athlete_id=c.id
        join public.player_pools p on p.season_id=m.season_id
        join public.pool_competitions pc on pc.pool_id=p.id and pc.competition_id=m.competition_id';
    when 'teams' then
      lookup := 'select pc.pool_id from %s c join public.pool_competitions pc on pc.competition_id=c.competition_id';
    when 'competitions' then
      lookup := 'select pc.pool_id from %s c join public.pool_competitions pc on pc.competition_id=c.id';
    when 'sports' then
      lookup := 'select pc.pool_id from %s c join public.competitions competition on competition.sport_id=c.id
        join public.pool_competitions pc on pc.competition_id=competition.id';
    when 'fantasy_seasons' then
      lookup := 'select p.id from %s c join public.player_pools p on p.season_id=c.id';
    when 'athlete_season_summaries' then
      lookup := 'select p.id from %s c join public.athlete_seasons m on m.athlete_id=c.athlete_id
        join public.player_pools p on p.season_id=m.season_id
        join public.pool_competitions pc on pc.pool_id=p.id and pc.competition_id=m.competition_id';
    when 'drafts' then
      lookup := 'select l.pool_id from %s c join public.leagues l on l.id=c.league_id
        where c.status=''complete'' and c.voided_at is null';
    when 'draft_picks' then
      lookup := 'select l.pool_id from %s c join public.drafts d on d.id=c.draft_id
        join public.leagues l on l.id=d.league_id where d.status=''complete'' and d.voided_at is null';
    when 'roster_slot_rules' then
      lookup := 'select l.pool_id from %s c join public.leagues l on l.ruleset_id=c.ruleset_id';
    when 'fantasy_teams' then
      if tg_op = 'UPDATE' then
        source := '(select o.* from old_rows o join new_rows n using(id)
          where (o.league_id,o.owner_id,o.name,o.draft_position) is distinct from (n.league_id,n.owner_id,n.name,n.draft_position)
          union all select n.* from old_rows o join new_rows n using(id)
          where (o.league_id,o.owner_id,o.name,o.draft_position) is distinct from (n.league_id,n.owner_id,n.name,n.draft_position))';
      end if;
      lookup := 'select l.pool_id from %s c join public.leagues l on l.id=c.league_id';
    when 'leagues' then
      if tg_op = 'UPDATE' then
        source := '(select o.* from old_rows o join new_rows n using(id)
          where (o.pool_id,o.ruleset_id) is distinct from (n.pool_id,n.ruleset_id)
          union all select n.* from old_rows o join new_rows n using(id)
          where (o.pool_id,o.ruleset_id) is distinct from (n.pool_id,n.ruleset_id))';
      end if;
      lookup := 'select pool_id from %s c';
    else raise exception 'Unsupported catalog invalidation source';
  end case;
  execute 'select array_agg(distinct pool_id order by pool_id) from (' || format(lookup,source) || ') affected(pool_id)
    where pool_id is not null' into affected;
  -- - Acquire shared pool rows in UUID order to keep multi-pool invalidation consistent
  foreach pool in array coalesce(affected,array[]::uuid[]) loop
    update public.player_pools set state_version=state_version+1 where id=pool;
  end loop;
  return null;
end;
$$;
revoke all on function beta_private.invalidate_draft_catalog() from public,anon,authenticated,service_role;

-- - Replace the narrower supplied-ADP trigger with complete summary invalidation
drop trigger if exists supplied_adp_revision on public.athlete_season_summaries;
do $$
declare relation text;
begin
  foreach relation in array array['pool_rankings','pool_competitions','athlete_seasons','athletes','teams',
    'competitions','sports','fantasy_seasons','athlete_season_summaries','drafts','draft_picks','roster_slot_rules','fantasy_teams','leagues'] loop
    execute format('drop trigger if exists draft_catalog_insert on public.%I',relation);
    execute format('drop trigger if exists draft_catalog_update on public.%I',relation);
    execute format('drop trigger if exists draft_catalog_delete on public.%I',relation);
    execute format('create trigger draft_catalog_insert after insert on public.%I referencing new table as new_rows
      for each statement execute function beta_private.invalidate_draft_catalog()',relation);
    execute format('create trigger draft_catalog_update after update on public.%I referencing old table as old_rows new table as new_rows
      for each statement execute function beta_private.invalidate_draft_catalog()',relation);
    execute format('create trigger draft_catalog_delete after delete on public.%I referencing old table as old_rows
      for each statement execute function beta_private.invalidate_draft_catalog()',relation);
  end loop;
end;
$$;

-- - Pool metadata edits invalidate the catalog without recursing on version-only updates
create or replace function beta_private.version_draft_pool() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.state_version := greatest(new.state_version,old.state_version);
  if (to_jsonb(new)-'state_version') is distinct from (to_jsonb(old)-'state_version') then
    new.state_version := greatest(new.state_version,old.state_version+1);
  end if;
  return new;
end;
$$;
revoke all on function beta_private.version_draft_pool() from public,anon,authenticated,service_role;
drop trigger if exists draft_pool_metadata on public.player_pools;
create trigger draft_pool_metadata before update on public.player_pools
  for each row execute function beta_private.version_draft_pool();

-- - Deleted participation records change acquisition eligibility without downgrading roster formats
create or replace function beta_private.deleted_participation_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
declare league uuid;
begin
  for league in select distinct m.league_id from public.league_members m join old_rows o on o.user_id=m.user_id order by m.league_id loop
    update public.leagues set state_version=state_version+1 where id=league;
  end loop;
  return null;
end;
$$;
revoke all on function beta_private.deleted_participation_catalog() from public,anon,authenticated,service_role;
drop trigger if exists deleted_participation_catalog on beta_private.account_participation;
create trigger deleted_participation_catalog after delete on beta_private.account_participation
  referencing old table as old_rows for each statement execute function beta_private.deleted_participation_catalog();

-- - Refresh existing clients after switching opaque revision formats
update public.player_pools set state_version=state_version+1;

create or replace function rpc_private.get_draft_room_snapshot(
  p_draft_id uuid,p_known_revision text default null,p_known_pool_revision text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  d public.drafts%rowtype; l public.leagues%rowtype; p public.player_pools%rowtype;
  adps jsonb; my_team uuid; q jsonb; roster jsonb; revision text; pool_revision text; result jsonb;
begin
  perform rpc_private.require_app_access();
  select * into d from public.drafts where id=p_draft_id;
  if d.id is null or not public.is_league_member(d.league_id) then
    raise exception 'Draft membership required' using errcode='42501';
  end if;
  select * into l from public.leagues where id=d.league_id;
  select * into p from public.player_pools where id=l.pool_id;
  if p.id is null then raise exception 'This draft requires a combined sport player pool'; end if;
  if d.status = 'complete' or d.voided_at is not null then
    return jsonb_build_object('closed',true,'replaced',d.voided_at is not null,'unchanged',false,
      'revision',d.state_version::text,'poolRevision',p.state_version::text,'serverTime',clock_timestamp(),
      'draft',jsonb_build_object('id',d.id,'league_id',l.id,'status',d.status,'rounds',d.rounds,
        'current_overall_pick',d.current_overall_pick,'state_version',d.state_version,'team_order','[]'::jsonb),
      'league',jsonb_build_object('id',l.id,'name',l.name,'pool_id',l.pool_id,'roster_format',l.roster_format,'commissioner_id',l.commissioner_id));
  end if;
  select id into my_team from public.fantasy_teams where league_id=l.id and owner_id=auth.uid();
  select coalesce(jsonb_agg(athlete_id order by priority),'[]') into q from public.draft_queues
    where draft_id=d.id and fantasy_team_id=my_team;
  select coalesce(jsonb_agg(jsonb_build_object('fantasy_team_id',fantasy_team_id,'athlete_id',athlete_id,
    'slot_code',slot_code,'status',status) order by fantasy_team_id,athlete_id),'[]')
    into roster from public.roster_entries where league_id=l.id and released_at is null;
  pool_revision:=p.id::text||':'||p.state_version::text;
  revision:=md5((to_jsonb(d)-'rankings_snapshot')::text||':'||to_jsonb(l)::text||':'||pool_revision||':'||q::text||':'||roster::text);
  result:=jsonb_build_object('revision',revision,'poolRevision',pool_revision,'serverTime',clock_timestamp());
  if revision=p_known_revision and pool_revision=p_known_pool_revision then
    return result||jsonb_build_object('unchanged',true);
  end if;
  result:=result||jsonb_build_object(
    'unchanged',false,'draft',to_jsonb(d)-'rankings_snapshot',
    'league',jsonb_build_object('id',l.id,'name',l.name,'pool_id',l.pool_id,'roster_format',l.roster_format,'commissioner_id',l.commissioner_id),
    'myTeamId',my_team,'queue',q,'roster',roster,
    'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'league_id',league_id,
      'owner_id',owner_id,'name',name,'draft_position',draft_position) order by draft_position),'[]')
      from public.fantasy_teams where league_id=l.id),
    'picks',(select coalesce(jsonb_agg(to_jsonb(dp) order by overall_pick),'[]') from public.draft_picks dp where draft_id=d.id),
    'slots',(select jsonb_agg(jsonb_build_object('teamId',t.id,'code',sr.slot_code,
      'label',sr.label,'positions',sr.allowed_positions) order by sr.is_starter desc,t.id,sr.slot_code,n)
      from public.fantasy_teams t join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id
      cross join lateral generate_series(1,sr.slot_count)n where t.league_id=l.id),
    'candidates',(with blocked_programs as materialized (
      select c.id competition_id,jsonb_agg(ft.id order by ft.id) team_ids
      from public.fantasy_teams ft join beta_private.account_participation participation on participation.user_id=ft.owner_id
      cross join public.competitions c join public.sports sport on sport.id=c.sport_id
      where ft.league_id=l.id and participation.role<>'none'
        and (c.division::text||'_'||sport.code::text)=any(participation.programs)
      group by c.id
    )
      select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,'ownerId',r.fantasy_team_id,
        'blockedTeamIds',case when r.fantasy_team_id is not null or actual_team.is_brock is distinct from true
          then '[]'::jsonb else coalesce(blocked.team_ids,'[]'::jsonb) end)
      order by (r.fantasy_team_id is null),a.athlete_id)
      from public.pool_competitions pc join public.athlete_seasons a on a.competition_id=pc.competition_id
      join public.athletes athlete on athlete.id=a.athlete_id and athlete.status='active'
      left join public.teams actual_team on actual_team.id=athlete.team_id
      left join blocked_programs blocked on blocked.competition_id=athlete.competition_id
      left join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.released_at is null
      where pc.pool_id=p.id and a.season_id=p.season_id and a.draft_eligible)
  );
  if pool_revision is distinct from p_known_pool_revision then
    adps:=beta_private.pool_adp(p.id);
    result:=result||jsonb_build_object('players',(
      select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'competition_id',a.competition_id,'team_id',a.team_id,
        'display_name',a.display_name,'position',a.position,'jersey_number',a.jersey_number,'status',a.status,'bio',a.bio,
        'positions',m.positions,'program',c.name,'rank',pr.rank,'adp',adps->a.id::text,
        'summaries',(select coalesce(jsonb_agg(to_jsonb(s)-'athlete_id'-'import_id'),'[]')
          from public.athlete_season_summaries s where s.athlete_id=a.id)) order by pr.rank),'[]')
      from public.pool_rankings pr join public.athletes a on a.id=pr.athlete_id and a.status='active'
      join public.athlete_seasons m on m.athlete_id=a.id and m.season_id=p.season_id and m.draft_eligible
      join public.competitions c on c.id=m.competition_id where pr.pool_id=p.id
    ));
  end if;
  return result;
end;
$$;

notify pgrst, 'reload schema';
