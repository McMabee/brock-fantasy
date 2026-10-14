-- The supplied number is one seed observation. Every completed, unvoided beta
-- draft contributes one persisted overall pick per athlete, across all leagues.
-- is_test is intentionally included: the existing beta marks every draft as test.
alter table public.athletes add column fantasy_withdrawn_at timestamptz;
create policy fantasy_withdrawal_read on public.athletes as restrictive for select to authenticated
  using (fantasy_withdrawn_at is null or (select public.current_user_is_admin()));

create function beta_private.pool_adp(p_pool_id uuid, p_league_size integer default null)
returns jsonb language sql stable security definer set search_path = '' as $$
with players as (
  select distinct a.id, fs.label from public.player_pools p
  join public.fantasy_seasons fs on fs.id = p.season_id
  join public.pool_competitions pc on pc.pool_id = p.id
  join public.athlete_seasons m on m.competition_id = pc.competition_id and m.season_id = p.season_id
  join public.athletes a on a.id = m.athlete_id
  where p.id = p_pool_id and p.is_active and m.directory_visible and a.status = 'active'
), seeds as (
  select a.id, case when count(s.supplied_adp) = count(*) and count(distinct s.supplied_adp) = 1
    then min(s.supplied_adp) end as base
  from players a left join public.athlete_season_summaries s on s.athlete_id = a.id
    and s.season_label = a.label and s.kind = 'supplied_projection'
  group by a.id
), observations as (
  select dp.athlete_id, sum(dp.overall_pick) as total, count(*) as samples,
    count(*) filter(where dp.source = 'autopick') as autopicks
  from public.leagues l join public.drafts d on d.league_id = l.id
  join public.draft_picks dp on dp.draft_id = d.id
  where l.pool_id = p_pool_id and d.status = 'complete' and d.voided_at is null
    and (p_league_size is null or d.league_size = p_league_size)
  group by dp.athlete_id
)
select coalesce(jsonb_object_agg(s.id::text, jsonb_build_object(
  'average', round((coalesce(s.base, 0) + coalesce(o.total, 0)) /
    nullif((case when s.base is null then 0 else 1 end) + coalesce(o.samples, 0), 0), 2),
  'base', s.base, 'samples', coalesce(o.samples, 0), 'autopicks', coalesce(o.autopicks, 0)
)), '{}'::jsonb) from seeds s left join observations o on o.athlete_id = s.id;
$$;
revoke all on function beta_private.pool_adp(uuid,integer) from public,anon,authenticated,service_role;

create function rpc_private.get_pool_adp(p_pool_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform rpc_private.require_app_access();
  return beta_private.pool_adp(p_pool_id);
end;
$$;
create function public.get_pool_adp(p_pool_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select rpc_private.get_pool_adp(p_pool_id);
$$;
create or replace function rpc_private.get_athlete_adp(p_athlete_id uuid,p_pool_id uuid,p_league_size integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform rpc_private.require_app_access();
  return coalesce(beta_private.pool_adp(p_pool_id,p_league_size)->p_athlete_id::text,
    jsonb_build_object('average',null,'base',null,'samples',0,'autopicks',0));
end;
$$;

create function rpc_private.get_draft_results(p_draft_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.drafts%rowtype; l public.leagues%rowtype;
begin
  perform rpc_private.require_app_access();
  select * into d from public.drafts where id = p_draft_id;
  if d.id is null or not public.is_league_member(d.league_id) then
    raise exception 'Draft membership required' using errcode = '42501';
  end if;
  if d.status <> 'complete' then raise exception 'Draft results are available after completion' using errcode = '22023'; end if;
  select * into l from public.leagues where id = d.league_id;
  return jsonb_build_object('league',jsonb_build_object('id',l.id,'name',l.name),
    'picks',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',dp.id,'athlete_id',dp.athlete_id,'overall_pick',dp.overall_pick,'round',dp.round,
      'pick_in_round',dp.pick_in_round,'source',dp.source,'team_name',t.name,
      'display_name',case when a.status = 'active' and m.directory_visible then a.display_name else 'Unavailable athlete' end,
      'bio',case when a.status = 'active' and m.directory_visible then a.bio else '{}'::jsonb end,
      'program',coalesce(c.name,'')) order by dp.overall_pick),'[]'::jsonb)
      from public.draft_picks dp join public.fantasy_teams t on t.id = dp.fantasy_team_id
      left join public.athletes a on a.id = dp.athlete_id
      left join public.player_pools p on p.id = l.pool_id
      left join public.athlete_seasons m on m.athlete_id = a.id and m.season_id = p.season_id
      left join public.competitions c on c.id = a.competition_id where dp.draft_id = d.id));
end;
$$;
create function public.get_draft_results(p_draft_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select rpc_private.get_draft_results(p_draft_id);
$$;

create function rpc_private.rename_my_fantasy_team(p_league_id uuid,p_name text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing jsonb; t public.fantasy_teams%rowtype;
begin
  perform rpc_private.require_app_access();
  existing := beta_private.begin_command('rename_my_fantasy_team',p_idempotency_key);
  if existing is not null then return existing; end if;
  if p_name is null or char_length(btrim(p_name)) not between 3 and 60 then
    raise exception 'Team name must be 3 to 60 characters' using errcode = '22023';
  end if;
  perform 1 from public.leagues where id = p_league_id for update;
  select * into t from public.fantasy_teams where league_id = p_league_id and owner_id = auth.uid() for update;
  if t.id is null or not public.is_league_member(p_league_id) then
    raise exception 'Your league team is required' using errcode = '42501';
  end if;
  update public.fantasy_teams set name = btrim(p_name) where id = t.id;
  update public.leagues set state_version = state_version + 1 where id = p_league_id;
  perform beta_private.audit('team.renamed','fantasy_team',t.id::text,jsonb_build_object('name',t.name),
    jsonb_build_object('name',btrim(p_name)),p_idempotency_key);
  return beta_private.finish_command('rename_my_fantasy_team',p_idempotency_key,jsonb_build_object('team_id',t.id,'name',btrim(p_name)));
end;
$$;
create function public.rename_my_fantasy_team(p_league_id uuid,p_name text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = '' as $$
  select rpc_private.rename_my_fantasy_team(p_league_id,p_name,p_idempotency_key);
$$;

revoke all on function rpc_private.get_pool_adp(uuid),public.get_pool_adp(uuid),
  rpc_private.get_draft_results(uuid),public.get_draft_results(uuid),
  rpc_private.rename_my_fantasy_team(uuid,text,text),public.rename_my_fantasy_team(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_pool_adp(uuid),public.get_pool_adp(uuid),
  rpc_private.get_draft_results(uuid),public.get_draft_results(uuid),
  rpc_private.rename_my_fantasy_team(uuid,text,text),public.rename_my_fantasy_team(uuid,text,text)
  to authenticated;

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
  if d.status = 'complete' then
    return jsonb_build_object('closed',true,'unchanged',false,
      'revision',d.state_version::text,'poolRevision',p.state_version::text,'serverTime',clock_timestamp(),
      'draft',jsonb_build_object('id',d.id,'league_id',l.id,'status',d.status,'rounds',d.rounds,
        'current_overall_pick',d.current_overall_pick,'state_version',d.state_version,'team_order','[]'::jsonb),
      'league',jsonb_build_object('id',l.id,'name',l.name,'pool_id',l.pool_id));
  end if;
  adps:=beta_private.pool_adp(p.id);
  select id into my_team from public.fantasy_teams where league_id=l.id and owner_id=auth.uid();
  select coalesce(jsonb_agg(athlete_id order by priority),'[]') into q from public.draft_queues
    where draft_id=d.id and fantasy_team_id=my_team;
  select coalesce(jsonb_agg(jsonb_build_object('fantasy_team_id',fantasy_team_id,'athlete_id',athlete_id,
    'slot_code',slot_code,'status',status) order by fantasy_team_id,athlete_id),'[]')
    into roster from public.roster_entries where league_id=l.id and released_at is null;
  pool_revision:=p.id::text||':'||p.state_version::text||':'||md5(adps::text);
  revision:=md5(d.state_version::text||':'||l.state_version::text||':'||pool_revision||':'||q::text||':'||roster::text);
  result:=jsonb_build_object('revision',revision,'poolRevision',pool_revision,'serverTime',clock_timestamp());
  if revision=p_known_revision and pool_revision=p_known_pool_revision then
    return result||jsonb_build_object('unchanged',true);
  end if;
  result:=result||jsonb_build_object(
    'unchanged',false,'draft',to_jsonb(d)-'rankings_snapshot',
    'league',jsonb_build_object('id',l.id,'name',l.name,'pool_id',l.pool_id),
    'myTeamId',my_team,'queue',q,'roster',roster,
    'teams',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'league_id',league_id,
      'owner_id',owner_id,'name',name,'draft_position',draft_position) order by draft_position),'[]')
      from public.fantasy_teams where league_id=l.id),
    'picks',(select coalesce(jsonb_agg(to_jsonb(dp) order by overall_pick),'[]') from public.draft_picks dp where draft_id=d.id),
    'slots',(select jsonb_agg(jsonb_build_object('teamId',t.id,'code',sr.slot_code,
      'label',sr.label,'positions',sr.allowed_positions) order by sr.is_starter desc,t.id,sr.slot_code,n)
      from public.fantasy_teams t join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id
      cross join lateral generate_series(1,sr.slot_count)n where t.league_id=l.id),
    'candidates',(select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,'ownerId',r.fantasy_team_id)
      order by (r.fantasy_team_id is null),a.athlete_id)
      from public.pool_competitions pc join public.athlete_seasons a on a.competition_id=pc.competition_id
      join public.athletes athlete on athlete.id=a.athlete_id and athlete.status='active'
      left join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.released_at is null
      where pc.pool_id=p.id and a.season_id=p.season_id and a.draft_eligible)
  );
  if pool_revision is distinct from p_known_pool_revision then
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

create or replace function rpc_private.get_beta_lineup(p_fantasy_team_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; fp public.fantasy_periods%rowtype; begin
  perform rpc_private.require_app_access();
  if not public.owns_fantasy_team(p_fantasy_team_id) then raise exception 'Team owner access required'; end if;
  select ll.* into l from public.leagues ll join public.fantasy_teams t on t.league_id=ll.id where t.id=p_fantasy_team_id;
  select f.* into fp from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id where p.id=l.pool_id and f.ends_at>clock_timestamp() order by f.starts_at limit 1;
  return jsonb_build_object('period',to_jsonb(fp),'state_version',l.state_version,'entries',coalesce((
    select jsonb_agg(jsonb_build_object('id',r.id,'athlete_id',r.athlete_id,'display_name',case when a.fantasy_withdrawn_at is null then a.display_name else 'Unavailable athlete' end,'positions',s.positions,'slot_code',r.slot_code,'status',r.status,
      'locked',beta_private.is_locked(l.id,a.id),'locks_at',beta_private.athlete_lock_at(l.id,a.id,fp.id),'unlocks_at',fp.ends_at))
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id join public.player_pools p on p.id=l.pool_id join public.athlete_seasons s on s.athlete_id=a.id and s.season_id=p.season_id
    where r.fantasy_team_id=p_fantasy_team_id and r.released_at is null),'[]'));
end $$;

notify pgrst, 'reload schema';
