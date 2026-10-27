set local lock_timeout = '2s';
set local statement_timeout = '30s';

create extension if not exists pg_trgm with schema extensions;

-- - Support ordered keyset reads and literal substring searches without per-league queries
create index leagues_admin_created on public.leagues(created_at desc,id desc);
create index leagues_admin_pool_status on public.leagues(pool_id,status,created_at desc,id desc);
create index leagues_admin_name on public.leagues using gin(lower(name) extensions.gin_trgm_ops);
create index fantasy_teams_admin_name on public.fantasy_teams using gin(lower(name) extensions.gin_trgm_ops);
create index profiles_admin_name on public.profiles using gin(lower(display_name) extensions.gin_trgm_ops);
create index chat_messages_admin_cursor on public.chat_messages(league_id,created_at desc,id desc);

create function beta_private.require_league_view_admin() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  if auth.uid() is null or not rpc_private.current_user_is_admin()
    or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Administrator MFA required' using errcode='42501';
  end if;
end;$$;

-- - Keep calendar selection independent of the league creation selector and pool activation
create function beta_private.league_view_current_season() returns uuid
language sql stable security invoker set search_path='' as $$
  select s.id from public.fantasy_seasons s
  join public.fantasy_periods f on f.season_id=s.id and f.phase='regular'
  where exists(select 1 from public.player_pools p where p.season_id=s.id and p.rankings_approved_at is not null)
  group by s.id having min(f.starts_at)<=statement_timestamp()
  order by min(f.starts_at) desc,s.id desc limit 1;
$$;

-- - Resolve both pool leagues and legacy competition labels without rewriting league data
create function beta_private.league_view_catalog()
returns table(id uuid,name text,status public.league_status,created_at timestamptz,
  commissioner_id uuid,max_members integer,season_id uuid,season_label text)
language sql stable security invoker set search_path='' as $$
  select l.id,l.name,l.status,l.created_at,l.commissioner_id,l.max_members,
    coalesce(s.id,legacy.id),coalesce(s.label,c.season_label,'Unassigned')
  from public.leagues l left join public.player_pools p on p.id=l.pool_id
  left join public.fantasy_seasons s on s.id=p.season_id
  left join public.competitions c on c.id=l.competition_id
  left join public.fantasy_seasons legacy on l.pool_id is null and legacy.label=c.season_label;
$$;

create function rpc_private.admin_get_league_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid; result jsonb;
begin
  perform beta_private.require_league_view_admin();
  current_id:=beta_private.league_view_current_season();
  select jsonb_build_object('currentSeasonId',current_id,
    'currentSeasonLabel',(select label from public.fantasy_seasons where id=current_id),
    'openCount',(select count(*) from beta_private.league_view_catalog() l
      where l.season_id=current_id and l.status in('setup','drafting','active')),
    'seasons',coalesce((select jsonb_agg(label order by label desc) from (
      select label from public.fantasy_seasons union select season_label from beta_private.league_view_catalog()
    )s),'[]'::jsonb)) into result;
  return result;
end;$$;

create function rpc_private.admin_list_leagues(p_season text default 'current',p_status text default 'open',
  p_query text default '',p_before_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid; pattern text; result jsonb; query_id uuid;
begin
  perform beta_private.require_league_view_admin();
  if p_season is null or p_status is null or p_query is null or char_length(p_query)>320
    or p_status not in('open','all','setup','drafting','active','complete','archived')
    or (p_before_at is null)<>(p_before_id is null) then
    raise exception 'Invalid league filters' using errcode='22023';
  end if;
  current_id:=beta_private.league_view_current_season();
  pattern:='%'||replace(replace(replace(lower(btrim(p_query)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  if btrim(p_query)~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then query_id:=btrim(p_query)::uuid;end if;
  with matching as materialized (
    select id from public.leagues where lower(name) like pattern or id=query_id
    union select league_id from public.fantasy_teams where lower(name) like pattern
    union select m.league_id from public.league_members m join public.profiles p on p.id=m.user_id
      where lower(p.display_name) like pattern
    union select m.league_id from public.league_members m join auth.users u on u.id=m.user_id
      where lower(u.email) like pattern
  ), page as materialized (
    select l.*,coalesce(p.display_name,'Unavailable account') commissioner
    from beta_private.league_view_catalog() l left join public.profiles p on p.id=l.commissioner_id and p.deleted_at is null
    where (p_season='all' or (p_season='current' and l.season_id=current_id)
      or (p_season='previous' and l.season_id is distinct from current_id and
        (l.season_id is null or exists(select 1 from public.fantasy_periods f where f.season_id=l.season_id
          and f.phase='regular' and f.starts_at<=(select min(starts_at) from public.fantasy_periods where season_id=current_id and phase='regular'))))
      or (p_season not in('all','current','previous') and l.season_label=p_season))
      and (p_status='all' or (p_status='open' and l.status in('setup','drafting','active')) or l.status::text=p_status)
      and (btrim(p_query)='' or l.id in(select id from matching))
      and (p_before_at is null or (l.created_at,l.id)<(p_before_at,p_before_id))
    order by l.created_at desc,l.id desc limit 26
  ), visible as materialized (select * from page order by created_at desc,id desc limit 25),
  counts as (select m.league_id,count(*) members from public.league_members m join visible v on v.id=m.league_id group by m.league_id)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('member_count',coalesce(c.members,0))
    order by v.created_at desc,v.id desc) from visible v left join counts c on c.league_id=v.id),'[]'::jsonb),
    'hasMore',(select count(*)>25 from page),'nextCursor',(select jsonb_build_object('at',created_at,'id',id)
      from visible order by created_at,id limit 1)) into result;
  return result;
end;$$;

create function rpc_private.admin_get_league_section(p_league_id uuid,p_section text default 'overview') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare header jsonb; teams jsonb; content jsonb;
begin
  perform beta_private.require_league_view_admin();
  if p_section is null or p_section not in('overview','members','rosters','standings','matchups','chat') then
    raise exception 'Invalid league section' using errcode='22023';end if;
  select to_jsonb(c)||jsonb_build_object('format',l.format,'roster_format',l.roster_format,
    'ruleset_name',r.name,'ruleset_version',r.version,'draft_status',d.status,'draft_mode',l.draft_mode,
    'draft_scheduled_for',l.draft_scheduled_for,'draft_pick_seconds',coalesce(l.draft_pick_seconds,d.pick_seconds),
    'commissioner',coalesce(p.display_name,'Unavailable account'),
    'free_agents_enabled',r.transaction_config->'freeAgentsEnabled','waivers_enabled',r.transaction_config->'waiversEnabled',
    'trades_enabled',r.transaction_config->'tradesEnabled') into header
  from public.leagues l join beta_private.league_view_catalog() c on c.id=l.id
  join public.scoring_rulesets r on r.id=l.ruleset_id left join public.profiles p on p.id=l.commissioner_id and p.deleted_at is null
  left join public.drafts d on d.league_id=l.id and d.voided_at is null where l.id=p_league_id;
  if header is null then raise exception 'League unavailable' using errcode='P0002';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'owner_id',t.owner_id,
    'owner_name',coalesce(p.display_name,'Unavailable account')) order by t.draft_position nulls last,t.id),'[]'::jsonb)
  into teams from public.fantasy_teams t left join public.profiles p on p.id=t.owner_id and p.deleted_at is null where t.league_id=p_league_id;
  case p_section
    when 'members' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',case when p.deleted_at is null then coalesce(p.display_name,'Unavailable account')else 'Unavailable account'end,
        'email',case when p.deleted_at is null then u.email end,'account_status',case
          when u.id is null or p.deleted_at is not null then 'Unavailable'
          when u.banned_until>statement_timestamp() then 'Suspended'
          when u.email_confirmed_at is null then 'Unverified' else 'Active' end,
        'role',m.role,'joined_at',m.joined_at,'is_varsity',coalesce(p.is_varsity,false),'team_name',t.name)
        order by m.joined_at,m.user_id),'[]'::jsonb) into content
      from public.league_members m left join public.profiles p on p.id=m.user_id left join auth.users u on u.id=m.user_id
      left join public.fantasy_teams t on t.league_id=m.league_id and t.owner_id=m.user_id where m.league_id=p_league_id;
    when 'standings' then
      select coalesce(jsonb_agg(to_jsonb(s) order by s.rank),'[]'::jsonb) into content from public.get_league_standings(p_league_id)s;
    when 'matchups' then
      select coalesce(jsonb_agg(to_jsonb(m) order by m.period,m.starts_at,m.id),'[]'::jsonb) into content from (
        select id,period,home_team_id,away_team_id,home_points,away_points,status,starts_at,ends_at,stage
        from public.matchups where league_id=p_league_id order by period,starts_at,id limit 1000
      )m;
    else content:='[]'::jsonb;
  end case;
  return jsonb_build_object('league',header,'teams',teams,'section',p_section,'items',content);
end;$$;

create function rpc_private.admin_get_league_roster(p_league_id uuid,p_team_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform beta_private.require_league_view_admin();
  if not exists(select 1 from public.fantasy_teams where id=p_team_id and league_id=p_league_id) then
    raise exception 'Team unavailable in this league' using errcode='P0002';end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.status,r.slot_code,r.id),'[]'::jsonb) into result from (
    select r.id,r.athlete_id,r.slot_code,r.status,a.display_name,a.position,a.jersey_number,c.name program_name
    from public.roster_entries r join public.athletes a on a.id=r.athlete_id
    join public.competitions c on c.id=a.competition_id
    where r.league_id=p_league_id and r.fantasy_team_id=p_team_id and r.released_at is null
    order by r.status,r.slot_code,r.id limit 100
  )r;
  return result;
end;$$;

create function rpc_private.admin_get_league_chat(p_league_id uuid,p_before_at timestamptz default null,
  p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform beta_private.require_league_view_admin();
  if not exists(select 1 from public.leagues where id=p_league_id) then raise exception 'League unavailable' using errcode='P0002';end if;
  if (p_before_at is null)<>(p_before_id is null) then raise exception 'Invalid chat cursor' using errcode='22023';end if;
  -- - Read hidden messages only through this admin-guarded function and never apply personal mutes
  with page as materialized (
    select m.id,m.author_id,coalesce(p.display_name,'Unavailable account') author,m.body,m.created_at,m.hidden_at
    from public.chat_messages m left join public.profiles p on p.id=m.author_id and p.deleted_at is null
    where m.league_id=p_league_id
      and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
    order by m.created_at desc,m.id desc limit 51
  ), visible as materialized (
    select * from page order by created_at desc,id desc limit 50
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by created_at,id) from visible v),'[]'::jsonb),
    'hasMore',(select count(*)>50 from page),'nextCursor',
      (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1))
    into result;
  return result;
end;$$;

-- - Expose invoker wrappers only and explicitly remove PostgreSQL default execution grants
create function public.admin_get_league_summary() returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_league_summary();$$;
create function public.admin_list_leagues(p_season text default 'current',p_status text default 'open',p_query text default '',p_before_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_list_leagues(p_season,p_status,p_query,p_before_at,p_before_id);$$;
create function public.admin_get_league_section(p_league_id uuid,p_section text default 'overview') returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_league_section(p_league_id,p_section);$$;
create function public.admin_get_league_roster(p_league_id uuid,p_team_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_league_roster(p_league_id,p_team_id);$$;
create function public.admin_get_league_chat(p_league_id uuid,p_before_at timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select rpc_private.admin_get_league_chat(p_league_id,p_before_at,p_before_id);$$;

revoke all on function beta_private.require_league_view_admin(),beta_private.league_view_current_season(),beta_private.league_view_catalog() from public,anon,authenticated,service_role;
do $$declare n text;signature text;begin
  foreach signature in array array['admin_get_league_summary()','admin_list_leagues(text,text,text,timestamptz,uuid)',
    'admin_get_league_section(uuid,text)','admin_get_league_roster(uuid,uuid)','admin_get_league_chat(uuid,timestamptz,uuid)'] loop
    foreach n in array array['public','rpc_private'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',n,signature);
      execute format('grant execute on function %I.%s to authenticated',n,signature);
    end loop;
  end loop;
end;$$;
notify pgrst,'reload schema';
