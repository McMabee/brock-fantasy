-- Public gameplay uses the immutable registration attestation, never editable
-- metadata or a client-supplied role. Staff commands retain their own AAL2 gates.
create or replace function rpc_private.can_use_app() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=auth.uid() and u.email_confirmed_at is not null and p.deleted_at is null
      and exists(select 1 from beta_private.account_eligibility_attestations e where e.user_id=u.id)
      and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=auth.jwt()->>'session_id')
  );
$$;

-- Existing accounts must personally confirm the same registration eligibility.
create function rpc_private.record_account_eligibility(p_attested boolean,p_policy_version text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if p_attested is distinct from true or p_policy_version is distinct from 'brock-beta-eligibility-2026-10-06.1' then
    raise exception 'Confirm that you are 18 or turn 18 this calendar year' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users a join public.profiles p on p.id=a.id
    where a.id=u and a.email_confirmed_at is not null and p.deleted_at is null
      and exists(select 1 from auth.sessions s where s.user_id=u and s.id::text=auth.jwt()->>'session_id')) then
    raise exception 'Verified active account required' using errcode='42501';
  end if;
  insert into beta_private.account_eligibility_attestations(user_id,registration_year,policy_version,attested_at)
  values(u,extract(year from timezone('America/Toronto',clock_timestamp()))::int,p_policy_version,clock_timestamp())
  on conflict(user_id) do nothing;
  return true;
end;
$$;
create function public.record_account_eligibility(p_attested boolean,p_policy_version text)
returns boolean language sql security invoker set search_path='' as $$
  select rpc_private.record_account_eligibility(p_attested,p_policy_version);
$$;
revoke all on function rpc_private.record_account_eligibility(boolean,text),public.record_account_eligibility(boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function rpc_private.record_account_eligibility(boolean,text),public.record_account_eligibility(boolean,text) to authenticated;

-- Iterative augmenting paths: each search visits each slot at most once.
-- Match mandatory owned athletes before unowned alternatives.
create function beta_private.complete_draft_graph(candidates jsonb, slots jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  nc integer:=jsonb_array_length(candidates); ns integer:=jsonb_array_length(slots);
  eligible boolean[][]; slot_owner integer[]; athlete_slot integer[];
  parents integer[]; seen boolean[]; queue integer[]; head integer; tail integer;
  root integer; cur integer; target integer; old_slot integer; matched integer:=0;
  result jsonb:='{}';
begin
  if nc<ns or ns=0 then return null; end if;
  select jsonb_agg(c order by (c->>'owner' is null),c->>'id') into candidates
    from jsonb_array_elements(candidates)c;
  -- Build the adjacency matrix in one SQL execution, instead of one SPI
  -- query per athlete/slot pair on every fallback pick candidate.
  select array_agg(edges order by ordinal) into eligible from (
    select c.ordinal,array_agg(
      (c.value->>'owner' is null or c.value->>'owner'=s.value->>'team')
      and s.value->'positions' ?| array(select jsonb_array_elements_text(c.value->'positions'))
      order by s.ordinal) edges
    from jsonb_array_elements(candidates) with ordinality c(value,ordinal)
    cross join jsonb_array_elements(slots) with ordinality s(value,ordinal)
    group by c.ordinal
  ) matrix;
  slot_owner:=array_fill(0,array[ns]); athlete_slot:=array_fill(0,array[nc]);
  for root in 1..nc loop
    if matched=ns and candidates->(root-1)->>'owner' is null then exit; end if;
    parents:=array_fill(0,array[ns]); seen:=array_fill(false,array[nc]);
    queue:=array_fill(0,array[nc]); queue[1]:=root; head:=1; tail:=1; seen[root]:=true; target:=0;
    while head<=tail and target=0 loop
      cur:=queue[head]; head:=head+1;
      for j in 1..ns loop
        if parents[j]<>0 or not eligible[cur][j] then continue; end if;
        parents[j]:=cur;
        if slot_owner[j]=0 then target:=j; exit; end if;
        if not seen[slot_owner[j]] then
          tail:=tail+1; queue[tail]:=slot_owner[j]; seen[slot_owner[j]]:=true;
        end if;
      end loop;
    end loop;
    if target=0 then
      if candidates->(root-1)->>'owner' is not null then return null; end if;
      continue;
    end if;
    matched:=matched+1;
    while target<>0 loop
      cur:=parents[target]; old_slot:=athlete_slot[cur];
      athlete_slot[cur]:=target; slot_owner[target]:=cur; target:=old_slot;
    end loop;
  end loop;
  if matched<>ns then return null; end if;
  for i in 1..nc loop
    if athlete_slot[i]<>0 then result:=result||jsonb_build_object(candidates->(i-1)->>'id',athlete_slot[i]-1); end if;
  end loop;
  return jsonb_build_object('owners',result,'slots',slots);
end;
$$;
revoke all on function beta_private.complete_draft_graph(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function beta_private.draft_completion(league uuid, chosen uuid default null, chosen_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare candidates jsonb; slots jsonb;
begin
  select jsonb_agg(jsonb_build_object('id',a.athlete_id,'positions',a.positions,
    'owner',case when a.athlete_id=chosen then chosen_team else r.fantasy_team_id end)
    order by (case when a.athlete_id=chosen then chosen_team else r.fantasy_team_id end is null),a.athlete_id)
  into candidates from public.leagues l join public.player_pools p on p.id=l.pool_id
  join public.pool_competitions pc on pc.pool_id=p.id
  join public.athlete_seasons a on a.competition_id=pc.competition_id and a.season_id=p.season_id and a.draft_eligible
  join public.athletes athlete on athlete.id=a.athlete_id and athlete.status='active'
  left join public.roster_entries r on r.league_id=l.id and r.athlete_id=a.athlete_id and r.released_at is null
  where l.id=league;
  select jsonb_agg(jsonb_build_object('team',t.id,'code',sr.slot_code,'positions',sr.allowed_positions)
    order by sr.is_starter desc,t.id,sr.slot_code,n)
  into slots from public.fantasy_teams t join public.leagues l on l.id=t.league_id
  join public.roster_slot_rules sr on sr.ruleset_id=l.ruleset_id
  cross join lateral generate_series(1,sr.slot_count) n where l.id=league;
  if candidates is null or slots is null or (chosen is not null and not exists(
    select 1 from jsonb_array_elements(candidates)c where c->>'id'=chosen::text
  )) then return null; end if;
  return beta_private.complete_draft_graph(candidates,slots);
end;
$$;

alter function public.process_expired_drafts(integer) set schema rpc_private;
alter function rpc_private.process_expired_drafts(integer) rename to process_expired_drafts_serial;
revoke all on function rpc_private.process_expired_drafts_serial(integer) from public,anon,authenticated,service_role;
create function rpc_private.process_expired_drafts(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'Worker access required' using errcode='42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('brock-draft-worker',0)) then
    return jsonb_build_object('processed',0,'busy',true);
  end if;
  return rpc_private.process_expired_drafts_serial(p_limit);
end;
$$;
revoke all on function rpc_private.process_expired_drafts(integer) from public,anon,authenticated,service_role;
grant execute on function rpc_private.process_expired_drafts(integer) to service_role;
create function public.process_expired_drafts(p_limit integer default 25)
returns jsonb language sql security invoker set search_path='' as $$
  select rpc_private.process_expired_drafts(p_limit);
$$;
revoke all on function public.process_expired_drafts(integer) from public,anon,authenticated,service_role;
grant execute on function public.process_expired_drafts(integer) to service_role;

create function rpc_private.get_draft_room_snapshot(
  p_draft_id uuid,p_known_revision text default null,p_known_pool_revision text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  d public.drafts%rowtype; l public.leagues%rowtype; p public.player_pools%rowtype;
  my_team uuid; q jsonb; roster jsonb; revision text; pool_revision text; result jsonb;
begin
  perform rpc_private.require_app_access();
  select * into d from public.drafts where id=p_draft_id;
  if d.id is null or not public.is_league_member(d.league_id) then
    raise exception 'Draft membership required' using errcode='42501';
  end if;
  select * into l from public.leagues where id=d.league_id;
  select * into p from public.player_pools where id=l.pool_id;
  if p.id is null then raise exception 'This draft requires a combined sport player pool'; end if;
  select id into my_team from public.fantasy_teams where league_id=l.id and owner_id=auth.uid();
  select coalesce(jsonb_agg(athlete_id order by priority),'[]') into q from public.draft_queues
    where draft_id=d.id and fantasy_team_id=my_team;
  select coalesce(jsonb_agg(jsonb_build_object('fantasy_team_id',fantasy_team_id,'athlete_id',athlete_id,
    'slot_code',slot_code,'status',status) order by fantasy_team_id,athlete_id),'[]')
    into roster from public.roster_entries where league_id=l.id and released_at is null;
  pool_revision:=p.id::text||':'||p.state_version::text;
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
        'positions',m.positions,'program',c.name,'rank',pr.rank,
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
create function public.get_draft_room_snapshot(p_draft_id uuid,p_known_revision text default null,p_known_pool_revision text default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select rpc_private.get_draft_room_snapshot(p_draft_id,p_known_revision,p_known_pool_revision);
$$;
revoke all on function rpc_private.get_draft_room_snapshot(uuid,text,text),public.get_draft_room_snapshot(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_draft_room_snapshot(uuid,text,text),public.get_draft_room_snapshot(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
