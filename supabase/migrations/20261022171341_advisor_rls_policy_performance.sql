set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- - Cache only values independent of the protected row within each statement
alter policy profiles_self_update on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy user_roles_self_read on public.user_roles
  using (user_id = (select auth.uid()) or (select rpc_private.current_user_is_admin()));
alter policy notifications_self_read on public.notifications using (user_id = (select auth.uid()));
alter policy notifications_self_update on public.notifications
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy push_tokens_self_read on public.push_tokens using (user_id = (select auth.uid()));
alter policy chat_messages_member_read on public.chat_messages using (
  rpc_private.is_league_member(league_id) and hidden_at is null and not exists (
    select 1 from public.chat_mutes m where m.league_id = chat_messages.league_id
      and m.user_id = (select auth.uid()) and m.muted_user_id = chat_messages.author_id
  )
);
alter policy chat_mutes_self_read on public.chat_mutes using (user_id = (select auth.uid()));
alter policy chat_reports_own_or_admin_read on public.chat_reports
  using (reporter_id = (select auth.uid()) or (select rpc_private.current_user_is_admin()));

-- - Keep administrator writes separate from the existing administrator SELECT branch
drop policy if exists athlete_rankings_admin_write on public.athlete_rankings;
create policy athlete_rankings_admin_insert on public.athlete_rankings for insert to authenticated
  with check ((select rpc_private.current_user_is_admin()));
create policy athlete_rankings_admin_update on public.athlete_rankings for update to authenticated
  using ((select rpc_private.current_user_is_admin())) with check ((select rpc_private.current_user_is_admin()));
create policy athlete_rankings_admin_delete on public.athlete_rankings for delete to authenticated
  using ((select rpc_private.current_user_is_admin()));
alter policy athlete_rankings_active_read on public.athlete_rankings using (
  exists(select 1 from public.competitions c where c.id = competition_id and c.is_active)
  or (select rpc_private.current_user_is_admin())
);

-- - Preserve the union of existing permissive rules and every restrictive policy
drop policy beta_memberships_read on public.athlete_seasons;
drop policy roster_directory_memberships_read on public.athlete_seasons;
create policy athlete_seasons_read on public.athlete_seasons for select to authenticated using (
  directory_visible or (select rpc_private.current_user_is_admin()) or exists (
    select 1 from public.player_pools p join public.pool_competitions pc on pc.pool_id = p.id
    where p.is_active and p.season_id = athlete_seasons.season_id
      and pc.competition_id = athlete_seasons.competition_id
  )
);

-- - Anonymous roles retain only their original read rule
alter policy active_athletes_public_read on public.athletes to anon;
drop policy roster_directory_athletes_read on public.athletes;
create policy athletes_authenticated_read on public.athletes for select to authenticated using (
  exists(select 1 from public.competitions c where c.id = athletes.competition_id and c.is_active)
  or (select rpc_private.current_user_is_admin())
  or (status = 'active' and exists(select 1 from public.athlete_seasons m where m.athlete_id = athletes.id and m.directory_visible))
);
alter policy active_competitions_public_read on public.competitions to anon;
drop policy roster_directory_competitions_read on public.competitions;
create policy competitions_authenticated_read on public.competitions for select to authenticated using (
  is_active or (select rpc_private.current_user_is_admin())
  or exists(select 1 from public.athlete_seasons m where m.competition_id = competitions.id and m.directory_visible)
);
alter policy active_teams_public_read on public.teams to anon;
drop policy roster_directory_teams_read on public.teams;
create policy teams_authenticated_read on public.teams for select to authenticated using (
  exists(select 1 from public.competitions c where c.id = teams.competition_id and c.is_active)
  or (select rpc_private.current_user_is_admin())
  or exists(select 1 from public.athlete_seasons m where m.team_id = teams.id and m.directory_visible)
);
drop policy profiles_own_read on public.profiles;
drop policy profiles_shared_league_read on public.profiles;
create policy profiles_member_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or rpc_private.shares_league(id));
drop policy beta_trades_league_read on public.trades;
drop policy trades_participant_or_commissioner_read on public.trades;
create policy trades_league_or_participant_read on public.trades for select to authenticated using (
  rpc_private.is_league_member(league_id) or rpc_private.owns_fantasy_team(proposing_team_id)
  or rpc_private.owns_fantasy_team(receiving_team_id) or rpc_private.is_league_commissioner(league_id)
);
drop policy beta_trade_items_league_read on public.trade_items;
drop policy trade_items_participant_read on public.trade_items;
create policy trade_items_league_or_participant_read on public.trade_items for select to authenticated using (
  exists(select 1 from public.trades t where t.id = trade_id and (
    rpc_private.is_league_member(t.league_id) or rpc_private.owns_fantasy_team(t.proposing_team_id)
    or rpc_private.owns_fantasy_team(t.receiving_team_id) or rpc_private.is_league_commissioner(t.league_id)
  ))
);

notify pgrst, 'reload schema';
