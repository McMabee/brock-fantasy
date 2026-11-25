set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Keep advisory availability independent of publication and gameplay eligibility
alter table public.athletes
  add column availability_status text not null default 'active' check (availability_status in ('active','injured')),
  add column availability_revision bigint not null default 0 check (availability_revision >= 0),
  add column availability_changed_at timestamptz;

create index roster_entries_current_athlete on public.roster_entries(athlete_id,fantasy_team_id)
  where released_at is null;

create function rpc_private.admin_set_athlete_availability(p_athlete_id uuid,p_availability_status text,
  p_expected_revision bigint,p_reason text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.athletes%rowtype; result jsonb; changed_at timestamptz; notices integer;
begin
  perform beta_private.require_league_view_admin();
  result:=beta_private.begin_command('admin_set_athlete_availability',p_idempotency_key);
  if result is not null then return result; end if;
  if p_availability_status is null or p_availability_status not in('active','injured')
    or p_reason is null or char_length(btrim(p_reason)) not between 8 and 500 then
    raise exception 'Choose Active or Injured and enter an audit reason of 8 to 500 characters' using errcode='22023';
  end if;
  select * into previous from public.athletes where id=p_athlete_id for update;
  if previous.id is null or previous.status<>'active' or previous.fantasy_withdrawn_at is not null
    or not exists(select 1 from public.athlete_seasons m where m.athlete_id=previous.id and m.directory_visible) then
    raise exception 'Athlete is not in the approved directory' using errcode='22023';
  end if;
  if p_expected_revision is null or p_expected_revision<>previous.availability_revision then
    raise exception 'Athlete status changed; review the latest status and retry' using errcode='PT409';
  end if;
  if previous.availability_status=p_availability_status then
    return beta_private.finish_command('admin_set_athlete_availability',p_idempotency_key,
      jsonb_build_object('changed',false,'revision',previous.availability_revision,'notificationCount',0));
  end if;
  changed_at:=clock_timestamp();
  update public.athletes set availability_status=p_availability_status,
    availability_revision=previous.availability_revision+1,availability_changed_at=changed_at where id=previous.id;
  -- - Resolve current owners once and deduplicate joins before creating durable inbox alerts
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
  select distinct t.owner_id,'athlete_'||p_availability_status,
    previous.display_name||case when p_availability_status='injured' then ' is injured' else ' is active again' end,
    case when p_availability_status='injured' then
      previous.display_name||' ('||previous.position||') has been marked Injured. Review '||t.name||' in '||l.name||' and find a replacement for that position.'
    else previous.display_name||' has returned to Active. Review '||t.name||'''s lineup in '||l.name||'.' end,
    jsonb_build_object('athlete_id',previous.id,'league_id',l.id,'fantasy_team_id',t.id,
      'pool_id',l.pool_id,'availability_revision',previous.availability_revision+1),
    'availability:'||previous.id||':'||(previous.availability_revision+1)||':'||l.id||':'||t.owner_id
  from public.roster_entries r join public.fantasy_teams t on t.id=r.fantasy_team_id
  join public.leagues l on l.id=t.league_id join public.profiles owner on owner.id=t.owner_id and owner.deleted_at is null
  where r.athlete_id=previous.id and r.released_at is null and l.status in('setup','drafting','active')
    and exists(select 1 from public.league_members member where member.league_id=l.id and member.user_id=t.owner_id)
  on conflict do nothing;
  get diagnostics notices=row_count;
  perform beta_private.audit('athlete.availability_updated','athlete',previous.id::text,
    jsonb_build_object('status',previous.availability_status,'revision',previous.availability_revision),
    jsonb_build_object('status',p_availability_status,'revision',previous.availability_revision+1,
      'reason',btrim(p_reason),'count',notices),p_idempotency_key);
  return beta_private.finish_command('admin_set_athlete_availability',p_idempotency_key,
    jsonb_build_object('changed',true,'revision',previous.availability_revision+1,
      'changedAt',changed_at,'notificationCount',notices));
end;$$;

create function public.admin_set_athlete_availability(p_athlete_id uuid,p_availability_status text,
  p_expected_revision bigint,p_reason text,p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$
  select rpc_private.admin_set_athlete_availability(p_athlete_id,p_availability_status,p_expected_revision,p_reason,p_idempotency_key);
$$;
revoke all on function rpc_private.admin_set_athlete_availability(uuid,text,bigint,text,text),
  public.admin_set_athlete_availability(uuid,text,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function rpc_private.admin_set_athlete_availability(uuid,text,bigint,text,text),
  public.admin_set_athlete_availability(uuid,text,bigint,text,text) to authenticated;

notify pgrst,'reload schema';
