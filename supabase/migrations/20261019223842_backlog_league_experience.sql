-- - Preview canonical pairings and sign all inputs used by generation
create function rpc_private.get_matchup_preview(p_league_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; teams uuid[]; n integer; fp record; pairs jsonb:='[]'; periods jsonb:='[]'; tail uuid; eligible integer:=0; payload jsonb;
begin
  perform rpc_private.require_app_access();
  select * into l from public.leagues where id=p_league_id;
  if l.id is null or not public.is_league_commissioner(l.id) then raise exception 'Commissioner access required' using errcode='42501'; end if;
  if l.pool_id is null then raise exception 'Combined league required'; end if;
  if not exists(select 1 from public.drafts where league_id=l.id and status='complete' and voided_at is null) then raise exception 'Complete the draft before setting up matchups'; end if;
  if exists(select 1 from public.matchups where league_id=l.id) then raise exception 'Schedule already generated'; end if;
  select array_agg(id order by preseason_order nulls last,id) into teams from public.fantasy_teams where league_id=l.id;
  n:=cardinality(teams);
  if n is null or n not in(4,6,8,10) or n<>l.max_members then raise exception 'All league seats must be filled'; end if;
  for fp in select f.* from public.fantasy_periods f join public.player_pools p on p.season_id=f.season_id
    where p.id=l.pool_id and f.phase='regular' order by f.number limit case when n=8 then 7 else 8 end loop
    eligible:=eligible+1;
    if fp.starts_at>clock_timestamp() then
      periods:=periods||jsonb_build_array(jsonb_build_object('id',fp.id,'number',fp.number,'starts_at',fp.starts_at,'ends_at',fp.ends_at));
      for i in 1..n/2 loop
        pairs:=pairs||jsonb_build_array(jsonb_build_object('period',fp.number,'starts_at',fp.starts_at,'ends_at',fp.ends_at,
          'home_team_id',case when fp.number%2=1 then teams[i] else teams[n-i+1] end,
          'away_team_id',case when fp.number%2=1 then teams[n-i+1] else teams[i] end));
      end loop;
    end if;
    tail:=teams[n];teams:=array[teams[1],tail]||teams[2:n-1];
  end loop;
  payload:=jsonb_build_object('league_id',l.id,'state_version',l.state_version,'periods',periods,'pairings',pairs,
    'shortened',jsonb_array_length(periods)<eligible,'can_generate',jsonb_array_length(periods)>0);
  return payload||jsonb_build_object('signature',md5(payload::text));
end $$;
create function public.get_matchup_preview(p_league_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.get_matchup_preview(p_league_id); $$;

create function rpc_private.confirm_matchup_schedule(p_league_id uuid,p_expected_signature text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing jsonb; preview jsonb; result jsonb;
begin
  perform rpc_private.require_app_access();
  existing:=beta_private.begin_command('confirm_matchup_schedule',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(p_league_id);
  preview:=rpc_private.get_matchup_preview(p_league_id);
  if p_expected_signature is null or preview->>'signature'<>p_expected_signature then raise exception 'Schedule preview changed; reload and review again' using errcode='40001'; end if;
  if (preview->>'can_generate')::boolean is not true then raise exception 'No unstarted eligible fantasy periods remain'; end if;
  insert into public.matchups(league_id,period,starts_at,ends_at,home_team_id,away_team_id)
  select p_league_id,p.period,p.starts_at,p.ends_at,p.home_team_id,p.away_team_id
  from jsonb_to_recordset(preview->'pairings')p(period integer,starts_at timestamptz,ends_at timestamptz,home_team_id uuid,away_team_id uuid);
  update public.leagues set state_version=state_version+1 where id=p_league_id;
  result:=jsonb_build_object('periods',jsonb_array_length(preview->'periods'),'matchups_created',jsonb_array_length(preview->'pairings'));
  perform beta_private.audit('matchups.generated','league',p_league_id::text,null,preview,p_idempotency_key);
  return beta_private.finish_command('confirm_matchup_schedule',p_idempotency_key,result);
end $$;
create function public.confirm_matchup_schedule(p_league_id uuid,p_expected_signature text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.confirm_matchup_schedule(p_league_id,p_expected_signature,p_idempotency_key); $$;

create function rpc_private.get_matchup_detail(p_league_id uuid,p_matchup_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matchups%rowtype;
begin
  perform rpc_private.require_app_access();
  if not public.is_league_member(p_league_id) then raise exception 'League membership required' using errcode='42501'; end if;
  select * into m from public.matchups where id=p_matchup_id and league_id=p_league_id;
  if m.id is null then raise exception 'Matchup not found'; end if;
  return jsonb_build_object('matchup',to_jsonb(m),'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,
    'roster',coalesce((select jsonb_agg(jsonb_build_object('athlete_id',a.id,'name',a.display_name,'position',a.position,'slot',r.slot_code,'status',r.status) order by r.status,r.slot_code,a.display_name)
      from public.roster_entries r join public.athletes a on a.id=r.athlete_id where r.fantasy_team_id=t.id and r.released_at is null and a.fantasy_withdrawn_at is null),'[]'),
    'contributors',coalesce((select jsonb_agg(to_jsonb(contributor) order by contributor.name) from (
      select e.athlete_id,a.display_name name,sum(e.points) points,count(distinct e.game_id) games
      from public.fantasy_point_events e join public.games g on g.id=e.game_id join public.athletes a on a.id=e.athlete_id
      where e.league_id=p_league_id and e.fantasy_team_id=t.id and g.starts_at>=m.starts_at and g.starts_at<m.ends_at
        and a.fantasy_withdrawn_at is null
      group by e.athlete_id,a.display_name) contributor),'[]')) order by t.id)
    from public.fantasy_teams t where t.id in(m.home_team_id,m.away_team_id)),'[]'));
end $$;
create function public.get_matchup_detail(p_league_id uuid,p_matchup_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.get_matchup_detail(p_league_id,p_matchup_id); $$;
revoke all on function rpc_private.get_matchup_preview(uuid),public.get_matchup_preview(uuid),rpc_private.confirm_matchup_schedule(uuid,text,text),public.confirm_matchup_schedule(uuid,text,text),rpc_private.get_matchup_detail(uuid,uuid),public.get_matchup_detail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_matchup_preview(uuid),public.get_matchup_preview(uuid),rpc_private.confirm_matchup_schedule(uuid,text,text),public.confirm_matchup_schedule(uuid,text,text),rpc_private.get_matchup_detail(uuid,uuid),public.get_matchup_detail(uuid,uuid) to authenticated;
notify pgrst,'reload schema';

-- - Keep older clients on the same future-only atomic generation path during rollout
create or replace function rpc_private.generate_matchup_schedule(p_league_id uuid,p_starts_at timestamptz,p_cycles integer,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.leagues%rowtype; existing jsonb; preview jsonb; result jsonb;
begin
  perform rpc_private.require_app_access();
  select * into l from public.leagues where id=p_league_id;
  if not public.is_league_commissioner(p_league_id) then raise exception 'Commissioner access required' using errcode='42501'; end if;
  if l.pool_id is null then return public.legacy_generate_matchup_schedule(p_league_id,p_starts_at,p_cycles,p_idempotency_key); end if;
  if l.max_members=8 and p_cycles<>1 then raise exception 'Eight-manager leagues use one round-robin cycle'; end if;
  existing:=beta_private.begin_command('generate_matchup_schedule',p_idempotency_key); if existing is not null then return existing; end if;
  perform beta_private.league_lock(p_league_id);
  preview:=rpc_private.get_matchup_preview(p_league_id);
  result:=rpc_private.confirm_matchup_schedule(p_league_id,preview->>'signature','compat-matchups-'||md5(p_idempotency_key));
  return beta_private.finish_command('generate_matchup_schedule',p_idempotency_key,result);
end $$;
