-- - Reject archived draft controls and expose the commissioner in draft snapshots
create or replace function rpc_private.set_draft_status(p_draft_id uuid,p_status public.draft_status,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.drafts%rowtype; existing jsonb; begin
  select * into d from public.drafts where id=p_draft_id;
  if not exists(select 1 from public.leagues where id=d.league_id and pool_id is not null) then return public.legacy_set_draft_status(p_draft_id,p_status::text,p_idempotency_key); end if;
  existing:=beta_private.begin_command('set_draft_status',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(d.league_id); select * into d from public.drafts where id=p_draft_id for update;
  if d.id is null or d.voided_at is not null then raise exception 'This draft has been replaced; open the current draft from your league' using errcode='22023'; end if;
  if not public.is_league_commissioner(d.league_id) then raise exception 'Commissioner access required'; end if;
  if d.status='active' and p_status='paused' then
    update public.drafts set status='paused',remaining_seconds=greatest(0,ceil(extract(epoch from pick_deadline-clock_timestamp())))::integer,pick_deadline=null,state_version=state_version+1 where id=d.id;
  elsif d.status='paused' and p_status='active' then
    update public.drafts set status='active',starts_at=coalesce(starts_at,clock_timestamp()),pick_deadline=clock_timestamp()+make_interval(secs=>coalesce(remaining_seconds,pick_seconds)),remaining_seconds=null,state_version=state_version+1 where id=d.id;
  else raise exception 'Only pause and resume are allowed'; end if;
  perform beta_private.audit('draft.status','draft',d.id::text,to_jsonb(d),jsonb_build_object('status',p_status),p_idempotency_key);
  return beta_private.finish_command('set_draft_status',p_idempotency_key,jsonb_build_object('status',p_status,'state_version',d.state_version+1));
end $$;

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
    'candidates',(select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,'ownerId',r.fantasy_team_id,'blockedTeamIds',case when r.fantasy_team_id is not null then '[]'::jsonb else coalesce((select jsonb_agg(ft.id) from public.fantasy_teams ft where ft.league_id=l.id and not beta_private.can_acquire_athlete(ft.id,a.athlete_id)),'[]'::jsonb) end)
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

notify pgrst, 'reload schema';
