create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.sport_code as enum ('hockey', 'basketball', 'volleyball');
create type public.division_code as enum ('mens', 'womens');
create type public.league_format as enum ('head_to_head', 'points_leaderboard');
create type public.league_status as enum ('setup', 'drafting', 'active', 'complete', 'archived');
create type public.league_member_role as enum ('member', 'commissioner');
create type public.platform_role as enum ('admin', 'support', 'sponsor_manager');
create type public.draft_status as enum ('scheduled', 'active', 'paused', 'complete');
create type public.draft_pick_source as enum ('manager', 'autopick', 'commissioner');
create type public.game_status as enum ('scheduled', 'in_progress', 'final', 'postponed', 'cancelled');
create type public.roster_status as enum ('starter', 'bench', 'injured_reserve');
create type public.transaction_type as enum ('draft', 'add', 'drop', 'waiver', 'trade', 'commissioner');
create type public.waiver_status as enum ('pending', 'successful', 'failed', 'cancelled');
create type public.trade_status as enum ('proposed', 'accepted', 'rejected', 'cancelled', 'expired');
create type public.matchup_status as enum ('scheduled', 'active', 'final');
create type public.point_event_kind as enum ('score', 'correction', 'admin_adjustment');
create type public.ruleset_status as enum ('draft', 'approved', 'retired');
create type public.sync_status as enum ('running', 'succeeded', 'failed', 'partial');
create type public.chat_report_status as enum ('open', 'resolved', 'dismissed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.platform_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  code public.sport_code not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.scoring_rulesets (
  id uuid primary key default gen_random_uuid(),
  sport public.sport_code not null,
  name text not null,
  version integer not null check (version > 0),
  status public.ruleset_status not null default 'draft',
  draft_config jsonb not null default '{}'::jsonb,
  transaction_config jsonb not null default '{}'::jsonb,
  matchup_config jsonb not null default '{}'::jsonb,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sport, name, version),
  check ((status = 'approved' and approved_at is not null) or status <> 'approved')
);

create table public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references public.scoring_rulesets(id) on delete cascade,
  stat_key text not null,
  label text not null,
  points numeric(10, 3) not null,
  sort_order integer not null default 0,
  unique (ruleset_id, stat_key)
);

create table public.roster_slot_rules (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references public.scoring_rulesets(id) on delete cascade,
  slot_code text not null,
  label text not null,
  allowed_positions text[] not null,
  slot_count integer not null check (slot_count > 0),
  is_starter boolean not null default true,
  unique (ruleset_id, slot_code)
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  division public.division_code not null,
  name text not null,
  season_label text not null,
  ruleset_id uuid not null references public.scoring_rulesets(id),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (sport_id, division, season_label)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  name text not null,
  short_name text not null,
  is_brock boolean not null default false,
  created_at timestamptz not null default now(),
  unique (competition_id, name)
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  display_name text not null,
  position text not null,
  jersey_number text,
  bio jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'inactive', 'unavailable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  starts_at timestamptz not null,
  status public.game_status not null default 'scheduled',
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);

create table public.provider_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  entity_type text not null check (entity_type in ('competition', 'team', 'athlete', 'game')),
  provider_entity_id text not null,
  internal_entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (provider, entity_type, provider_entity_id)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  competition_id uuid references public.competitions(id) on delete cascade,
  status public.sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  ignored_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table public.provider_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  game_id uuid not null references public.games(id) on delete cascade,
  source_identity text not null unique,
  provider_revision text,
  game_status public.game_status not null,
  captured_at timestamptz not null,
  payload jsonb not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.provider_raw_receipts (
  id uuid primary key default gen_random_uuid(),
  source_hint text,
  payload jsonb not null,
  payload_hash text not null unique,
  validation_status text not null default 'received' check (validation_status in ('received', 'accepted', 'rejected')),
  validation_error text,
  provider_snapshot_id uuid references public.provider_snapshots(id) on delete set null,
  received_at timestamptz not null default now()
);

create table public.sync_errors (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references public.sync_runs(id) on delete cascade,
  provider_snapshot_id uuid references public.provider_snapshots(id) on delete cascade,
  error_code text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.normalized_player_game_stats (
  game_id uuid not null references public.games(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  source_identity text not null,
  stats jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, athlete_id)
);

create table public.stat_revisions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  source_identity text not null,
  previous_stats jsonb,
  corrected_stats jsonb not null,
  created_at timestamptz not null default now(),
  unique (game_id, athlete_id, source_identity)
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id),
  commissioner_id uuid references public.profiles(id) on delete set null,
  ruleset_id uuid not null references public.scoring_rulesets(id),
  name text not null check (char_length(name) between 3 and 60),
  format public.league_format not null,
  status public.league_status not null default 'setup',
  max_members integer not null default 8 check (max_members between 2 and 20),
  invite_code extensions.citext not null unique,
  state_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.league_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.fantasy_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 3 and 60),
  draft_position integer,
  waiver_priority integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, owner_id),
  unique (league_id, draft_position)
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.leagues(id) on delete cascade,
  status public.draft_status not null default 'scheduled',
  rounds integer not null check (rounds > 0),
  pick_seconds integer not null check (pick_seconds between 15 and 86400),
  team_order uuid[] not null default '{}'::uuid[],
  current_overall_pick integer not null default 1 check (current_overall_pick > 0),
  pick_deadline timestamptz,
  state_version bigint not null default 1,
  starts_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id),
  overall_pick integer not null check (overall_pick > 0),
  round integer not null check (round > 0),
  pick_in_round integer not null check (pick_in_round > 0),
  source public.draft_pick_source not null,
  created_at timestamptz not null default now(),
  unique (draft_id, overall_pick),
  unique (draft_id, athlete_id)
);

create table public.roster_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id),
  slot_code text not null,
  status public.roster_status not null default 'bench',
  acquired_at timestamptz not null default now(),
  released_at timestamptz,
  acquisition_type public.transaction_type not null,
  created_at timestamptz not null default now()
);

create unique index roster_entries_one_active_owner
  on public.roster_entries (league_id, athlete_id)
  where released_at is null;

create table public.roster_transactions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  transaction_type public.transaction_type not null,
  athlete_in_id uuid references public.athletes(id),
  athlete_out_id uuid references public.athletes(id),
  initiated_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (athlete_in_id is not null or athlete_out_id is not null)
);

create table public.waiver_claims (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  athlete_in_id uuid not null references public.athletes(id),
  athlete_out_id uuid references public.athletes(id),
  priority_at_claim integer not null,
  status public.waiver_status not null default 'pending',
  process_after timestamptz not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  proposing_team_id uuid not null references public.fantasy_teams(id),
  receiving_team_id uuid not null references public.fantasy_teams(id),
  proposed_by uuid references public.profiles(id) on delete set null,
  status public.trade_status not null default 'proposed',
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (proposing_team_id <> receiving_team_id)
);

create table public.trade_items (
  trade_id uuid not null references public.trades(id) on delete cascade,
  from_team_id uuid not null references public.fantasy_teams(id),
  to_team_id uuid not null references public.fantasy_teams(id),
  athlete_id uuid not null references public.athletes(id),
  primary key (trade_id, athlete_id),
  check (from_team_id <> to_team_id)
);

create table public.matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  period integer not null check (period > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  home_team_id uuid not null references public.fantasy_teams(id),
  away_team_id uuid not null references public.fantasy_teams(id),
  home_points numeric(12, 3) not null default 0,
  away_points numeric(12, 3) not null default 0,
  status public.matchup_status not null default 'scheduled',
  finalized_at timestamptz,
  unique (league_id, period, home_team_id),
  check (home_team_id <> away_team_id and starts_at < ends_at)
);

create table public.lineup_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id),
  slot_code text not null,
  locked_at timestamptz not null,
  unique (fantasy_team_id, game_id, athlete_id),
  unique (fantasy_team_id, game_id, slot_code)
);

create table public.fantasy_point_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  fantasy_team_id uuid not null references public.fantasy_teams(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id),
  game_id uuid not null references public.games(id) on delete cascade,
  ruleset_id uuid not null references public.scoring_rulesets(id),
  stat_key text not null,
  stat_value numeric(14, 4) not null,
  points numeric(14, 3) not null,
  kind public.point_event_kind not null,
  source_identity text not null,
  created_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (fantasy_team_id, athlete_id, game_id, stat_key, source_identity, kind)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  push_token_id uuid not null references public.push_tokens(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ticketed', 'delivered', 'failed')),
  expo_ticket_id text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, push_token_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 500),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index chat_messages_league_created on public.chat_messages (league_id, created_at desc);

create table public.chat_mutes (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id, muted_user_id),
  check (user_id <> muted_user_id)
);

create table public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  status public.chat_report_status not null default 'open',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination_url text not null,
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create table public.sponsor_campaigns (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors(id) on delete cascade,
  competition_id uuid references public.competitions(id) on delete cascade,
  placement text not null,
  creative_url text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'complete')),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table public.sponsor_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sponsor_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('impression', 'click')),
  occurred_on date not null default current_date,
  count integer not null default 1 check (count > 0),
  unique (campaign_id, event_type, occurred_on)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create table public.idempotency_keys (
  user_id uuid not null references public.profiles(id) on delete cascade,
  command text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, command, idempotency_key)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger athletes_touch before update on public.athletes for each row execute function public.touch_updated_at();
create trigger games_touch before update on public.games for each row execute function public.touch_updated_at();
create trigger leagues_touch before update on public.leagues for each row execute function public.touch_updated_at();
create trigger fantasy_teams_touch before update on public.fantasy_teams for each row execute function public.touch_updated_at();
create trigger push_tokens_touch before update on public.push_tokens for each row execute function public.touch_updated_at();
create trigger push_deliveries_touch before update on public.push_deliveries for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)), 60));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

create index provider_snapshots_game_received on public.provider_snapshots (game_id, received_at desc);
create index provider_raw_receipts_status_received on public.provider_raw_receipts (validation_status, received_at desc);
create index normalized_stats_athlete on public.normalized_player_game_stats (athlete_id, game_id);
create index fantasy_point_events_team_game on public.fantasy_point_events (fantasy_team_id, game_id);
create index roster_entries_team_active on public.roster_entries (fantasy_team_id) where released_at is null;
create index waiver_claims_process on public.waiver_claims (league_id, process_after, priority_at_claim) where status = 'pending';
create index notifications_user_unread on public.notifications (user_id, created_at desc) where read_at is null;
create index push_deliveries_pending on public.push_deliveries (status, updated_at) where status in ('pending', 'ticketed');
create index audit_log_entity on public.audit_log (entity_type, entity_id, created_at desc);
