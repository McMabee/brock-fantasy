-- - Add authenticated trade context without exposing another league's ownership
create function rpc_private.get_player_trade_options(p_athlete_id uuid,p_league_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform rpc_private.require_app_access();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'league_id',l.id,'league_name',l.name,'proposing_team_id',mine.id,
    'receiving_team_id',other.id,'receiving_team_name',other.name,'athlete_name',athlete.display_name,
    'offered',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name) order by a.display_name),'[]')
      from public.roster_entries owned join public.athletes a on a.id=owned.athlete_id
      where owned.fantasy_team_id=mine.id and owned.released_at is null and a.fantasy_withdrawn_at is null
        and beta_private.can_acquire_athlete(other.id,a.id))) order by l.name,l.id)
    from public.fantasy_teams mine join public.leagues l on l.id=mine.league_id
    join public.scoring_rulesets rules on rules.id=l.ruleset_id
    join public.roster_entries target on target.league_id=l.id and target.athlete_id=p_athlete_id and target.released_at is null
    join public.fantasy_teams other on other.id=target.fantasy_team_id
    join public.athletes athlete on athlete.id=target.athlete_id
    where mine.owner_id=(select auth.uid()) and other.id<>mine.id and l.status='active'
      and public.is_league_member(l.id) and (p_league_id is null or l.id=p_league_id)
      and (rules.transaction_config->>'tradesEnabled')::boolean is true
      and athlete.status='active' and athlete.fantasy_withdrawn_at is null
      and beta_private.can_acquire_athlete(mine.id,athlete.id)),'[]');
end $$;
create function public.get_player_trade_options(p_athlete_id uuid,p_league_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select rpc_private.get_player_trade_options(p_athlete_id,p_league_id); $$;
revoke all on function rpc_private.get_player_trade_options(uuid,uuid),public.get_player_trade_options(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function rpc_private.get_player_trade_options(uuid,uuid),public.get_player_trade_options(uuid,uuid) to authenticated;

alter table public.waiver_claims add column outcome_reason text;
create index waiver_claims_team_created on public.waiver_claims(fantasy_team_id,created_at desc);
grant select on public.waiver_claims to authenticated;

-- - Deliver one durable owner-only outcome from either waiver settlement implementation
create function beta_private.notify_waiver_outcome() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status=old.status or new.status::text not in ('successful','failed') then return new; end if;
  if new.status::text='failed' and new.outcome_reason is null then
    new.outcome_reason:=case when exists(select 1 from public.roster_entries r where r.league_id=new.league_id and r.athlete_id=new.athlete_in_id and r.released_at is null and r.fantasy_team_id<>new.fantasy_team_id)
      then 'Another team acquired this athlete before your claim could complete.'
      else 'The claim could not complete because availability, roster eligibility or game locks changed.' end;
  end if;
  if new.status::text='successful' and exists(select 1 from public.leagues where id=new.league_id and pool_id is null) then return new; end if;
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
  select t.owner_id,'waiver_result',case when new.status::text='successful' then 'Waiver claim successful' else 'Waiver claim unsuccessful' end,
    case when new.status::text='successful' then 'Your roster has been updated.' else new.outcome_reason end,
    jsonb_build_object('league_id',new.league_id,'claim_id',new.id,'status',new.status),
    'waiver:'||new.id||':'||new.status||':'||t.owner_id
  from public.fantasy_teams t where t.id=new.fantasy_team_id and t.owner_id is not null on conflict do nothing;
  return new;
end $$;
revoke all on function beta_private.notify_waiver_outcome() from public,anon,authenticated,service_role;
create trigger waiver_outcome_notification before update of status on public.waiver_claims for each row execute function beta_private.notify_waiver_outcome();

create function beta_private.notify_draft_progress() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer; turn_index integer; round_index integer;
begin
  if not exists(select 1 from public.leagues where id=new.league_id and pool_id is not null) then return new; end if;
  if new.status::text='active' and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
    select m.user_id,'draft_started','Your draft has started','Open the draft room to follow picks.',jsonb_build_object('league_id',new.league_id,'draft_id',new.id),'draft-start:'||new.id||':'||m.user_id
    from public.league_members m where m.league_id=new.league_id on conflict do nothing;
  end if;
  if new.status::text='active' and ((tg_op='INSERT' or old.status is distinct from new.status) or old.current_overall_pick<>new.current_overall_pick) then
    n:=cardinality(new.team_order);
    if n>0 then
      round_index:=(new.current_overall_pick-1)/n;
      turn_index:=case when round_index%2=0 then (new.current_overall_pick-1)%n+1 else n-(new.current_overall_pick-1)%n end;
      insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
      select t.owner_id,'draft_turn','You are on the clock','It is your turn to draft. Open the draft room.',jsonb_build_object('league_id',new.league_id,'draft_id',new.id,'pick',new.current_overall_pick),'draft-turn:'||new.id||':'||new.current_overall_pick||':'||t.owner_id
      from public.fantasy_teams t where t.id=new.team_order[turn_index] and t.owner_id is not null on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
revoke all on function beta_private.notify_draft_progress() from public,anon,authenticated,service_role;
create trigger draft_progress_notifications after insert or update of status,current_overall_pick on public.drafts for each row execute function beta_private.notify_draft_progress();

create function beta_private.notify_matchup_result() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status::text='final' and old.status is distinct from new.status then
    insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
    select t.owner_id,'matchup_final','Your matchup is final','Period '||new.period||' result: '||new.home_points||'–'||new.away_points||'.',jsonb_build_object('league_id',new.league_id,'matchup_id',new.id,'period',new.period),'matchup-final:'||new.id||':'||t.owner_id
    from public.fantasy_teams t where t.id in(new.home_team_id,new.away_team_id) and t.owner_id is not null on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function beta_private.notify_matchup_result() from public,anon,authenticated,service_role;
create trigger matchup_result_notifications after update of status on public.matchups for each row execute function beta_private.notify_matchup_result();

create function beta_private.notify_roster_schedule_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.starts_at is not distinct from new.starts_at and old.status is not distinct from new.status then return new; end if;
  if new.status::text not in ('scheduled','postponed','cancelled') then return new; end if;
  insert into public.notifications(user_id,kind,title,body,data,dedupe_key)
  select distinct t.owner_id,'game_schedule_changed','A rostered athlete’s schedule changed','Review the updated game time or status before saving your lineup.',jsonb_build_object('league_id',t.league_id,'game_id',new.id),'game-change:'||new.id||':'||new.state_version||':'||t.league_id||':'||t.owner_id
  from public.roster_entries r join public.fantasy_teams t on t.id=r.fantasy_team_id
  join public.athlete_seasons m on m.athlete_id=r.athlete_id and m.competition_id=new.competition_id
  where r.released_at is null and m.team_id in(new.home_team_id,new.away_team_id) and t.owner_id is not null on conflict do nothing;
  return new;
end $$;
revoke all on function beta_private.notify_roster_schedule_change() from public,anon,authenticated,service_role;
create trigger roster_schedule_notifications after update of starts_at,status on public.games for each row execute function beta_private.notify_roster_schedule_change();
notify pgrst,'reload schema';
