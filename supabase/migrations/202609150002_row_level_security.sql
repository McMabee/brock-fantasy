create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role = 'admin'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  ) or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = auth.uid()
  ) or public.current_user_is_admin();
$$;

create or replace function public.is_league_commissioner(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = auth.uid() and role = 'commissioner'
  ) or public.current_user_is_admin();
$$;

create or replace function public.owns_fantasy_team(p_fantasy_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fantasy_teams
    where id = p_fantasy_team_id and owner_id = auth.uid()
  ) or public.current_user_is_admin();
$$;

create or replace function public.shares_league(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = auth.uid() or exists (
    select 1
    from public.league_members mine
    join public.league_members theirs on theirs.league_id = mine.league_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  ) or public.current_user_is_admin();
$$;

revoke all on function public.current_user_is_admin() from public, anon, authenticated, service_role;
revoke all on function public.is_league_member(uuid) from public, anon, authenticated, service_role;
revoke all on function public.is_league_commissioner(uuid) from public, anon, authenticated, service_role;
revoke all on function public.owns_fantasy_team(uuid) from public, anon, authenticated, service_role;
revoke all on function public.shares_league(uuid) from public, anon, authenticated, service_role;
grant execute on function public.current_user_is_admin() to anon, authenticated;
grant execute on function public.is_league_member(uuid) to authenticated;
grant execute on function public.is_league_commissioner(uuid) to authenticated;
grant execute on function public.owns_fantasy_team(uuid) to authenticated;
grant execute on function public.shares_league(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.sports enable row level security;
alter table public.scoring_rulesets enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.roster_slot_rules enable row level security;
alter table public.competitions enable row level security;
alter table public.teams enable row level security;
alter table public.athletes enable row level security;
alter table public.games enable row level security;
alter table public.provider_entity_mappings enable row level security;
alter table public.sync_runs enable row level security;
alter table public.provider_snapshots enable row level security;
alter table public.provider_raw_receipts enable row level security;
alter table public.sync_errors enable row level security;
alter table public.normalized_player_game_stats enable row level security;
alter table public.stat_revisions enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.fantasy_teams enable row level security;
alter table public.drafts enable row level security;
alter table public.draft_picks enable row level security;
alter table public.roster_entries enable row level security;
alter table public.roster_transactions enable row level security;
alter table public.waiver_claims enable row level security;
alter table public.trades enable row level security;
alter table public.trade_items enable row level security;
alter table public.matchups enable row level security;
alter table public.lineup_entries enable row level security;
alter table public.fantasy_point_events enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.push_deliveries enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_reports enable row level security;
alter table public.sponsors enable row level security;
alter table public.sponsor_campaigns enable row level security;
alter table public.sponsor_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.idempotency_keys enable row level security;

create policy profiles_shared_league_read on public.profiles
  for select to authenticated using (public.shares_league(id));
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_self_read on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.current_user_is_admin());

create policy sports_public_read on public.sports for select to anon, authenticated using (true);
create policy approved_rulesets_public_read on public.scoring_rulesets
  for select to anon, authenticated using (status = 'approved' or public.current_user_is_admin());
create policy approved_scoring_rules_public_read on public.scoring_rules
  for select to anon, authenticated using (
    exists (select 1 from public.scoring_rulesets r where r.id = ruleset_id and r.status = 'approved')
    or public.current_user_is_admin()
  );
create policy approved_roster_rules_public_read on public.roster_slot_rules
  for select to anon, authenticated using (
    exists (select 1 from public.scoring_rulesets r where r.id = ruleset_id and r.status = 'approved')
    or public.current_user_is_admin()
  );
create policy active_competitions_public_read on public.competitions
  for select to anon, authenticated using (is_active or public.current_user_is_admin());
create policy active_teams_public_read on public.teams
  for select to anon, authenticated using (
    exists (select 1 from public.competitions c where c.id = competition_id and c.is_active)
    or public.current_user_is_admin()
  );
create policy active_athletes_public_read on public.athletes
  for select to anon, authenticated using (
    exists (select 1 from public.competitions c where c.id = competition_id and c.is_active)
    or public.current_user_is_admin()
  );
create policy active_games_public_read on public.games
  for select to anon, authenticated using (
    exists (select 1 from public.competitions c where c.id = competition_id and c.is_active)
    or public.current_user_is_admin()
  );

create policy mappings_admin_only on public.provider_entity_mappings
  for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy sync_runs_admin_only on public.sync_runs
  for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy snapshots_admin_only on public.provider_snapshots
  for select to authenticated using (public.current_user_is_admin());
create policy raw_receipts_admin_only on public.provider_raw_receipts
  for select to authenticated using (public.current_user_is_admin());
create policy sync_errors_admin_only on public.sync_errors
  for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy normalized_stats_active_read on public.normalized_player_game_stats
  for select to authenticated using (
    exists (
      select 1 from public.games g
      join public.competitions c on c.id = g.competition_id
      where g.id = game_id and c.is_active
    ) or public.current_user_is_admin()
  );
create policy stat_revisions_admin_only on public.stat_revisions
  for select to authenticated using (public.current_user_is_admin());

create policy leagues_member_read on public.leagues
  for select to authenticated using (public.is_league_member(id));
create policy league_members_member_read on public.league_members
  for select to authenticated using (public.is_league_member(league_id));
create policy fantasy_teams_member_read on public.fantasy_teams
  for select to authenticated using (public.is_league_member(league_id));
create policy drafts_member_read on public.drafts
  for select to authenticated using (public.is_league_member(league_id));
create policy draft_picks_member_read on public.draft_picks
  for select to authenticated using (
    exists (select 1 from public.drafts d where d.id = draft_id and public.is_league_member(d.league_id))
  );
create policy roster_entries_member_read on public.roster_entries
  for select to authenticated using (public.is_league_member(league_id));
create policy roster_transactions_member_read on public.roster_transactions
  for select to authenticated using (public.is_league_member(league_id));
create policy waiver_claims_own_or_commissioner_read on public.waiver_claims
  for select to authenticated using (
    public.owns_fantasy_team(fantasy_team_id) or public.is_league_commissioner(league_id)
  );
create policy trades_participant_or_commissioner_read on public.trades
  for select to authenticated using (
    public.owns_fantasy_team(proposing_team_id)
    or public.owns_fantasy_team(receiving_team_id)
    or public.is_league_commissioner(league_id)
  );
create policy trade_items_participant_read on public.trade_items
  for select to authenticated using (
    exists (
      select 1 from public.trades t
      where t.id = trade_id and (
        public.owns_fantasy_team(t.proposing_team_id)
        or public.owns_fantasy_team(t.receiving_team_id)
        or public.is_league_commissioner(t.league_id)
      )
    )
  );
create policy matchups_member_read on public.matchups
  for select to authenticated using (public.is_league_member(league_id));
create policy lineup_entries_member_read on public.lineup_entries
  for select to authenticated using (public.is_league_member(league_id));
create policy point_events_member_read on public.fantasy_point_events
  for select to authenticated using (public.is_league_member(league_id));

create policy notifications_self_read on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_self_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_self_read on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy push_deliveries_admin_read on public.push_deliveries
  for select to authenticated using (public.current_user_is_admin());

create policy chat_messages_member_read on public.chat_messages
  for select to authenticated using (
    public.is_league_member(league_id)
    and hidden_at is null
    and not exists (
      select 1 from public.chat_mutes m
      where m.league_id = chat_messages.league_id
        and m.user_id = auth.uid()
        and m.muted_user_id = chat_messages.author_id
    )
  );
create policy chat_mutes_self_read on public.chat_mutes
  for select to authenticated using (user_id = auth.uid());
create policy chat_reports_own_or_admin_read on public.chat_reports
  for select to authenticated using (reporter_id = auth.uid() or public.current_user_is_admin());

create policy active_sponsors_public_read on public.sponsors
  for select to anon, authenticated using (status = 'active' or public.current_user_is_admin());
create policy active_campaigns_public_read on public.sponsor_campaigns
  for select to anon, authenticated using (
    (status = 'active' and now() between starts_at and ends_at) or public.current_user_is_admin()
  );
create policy sponsor_events_admin_only on public.sponsor_events
  for select to authenticated using (public.current_user_is_admin());
create policy audit_admin_only on public.audit_log
  for select to authenticated using (public.current_user_is_admin());

revoke insert, update, delete on public.audit_log from anon, authenticated;
revoke all on public.idempotency_keys from anon, authenticated;
revoke insert, update, delete on public.provider_snapshots from anon, authenticated;
revoke insert, update, delete on public.provider_raw_receipts from anon, authenticated;
revoke insert, update, delete on public.normalized_player_game_stats from anon, authenticated;
revoke insert, update, delete on public.fantasy_point_events from anon, authenticated;
