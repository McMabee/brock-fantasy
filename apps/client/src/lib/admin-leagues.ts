import type { LeagueStatus } from '@brock-fantasy/domain';

export const LEAGUE_SECTIONS = [
  'overview',
  'members',
  'rosters',
  'standings',
  'matchups',
  'chat',
] as const;
export type LeagueSection = (typeof LEAGUE_SECTIONS)[number];
export const LEAGUE_STATUS_FILTERS = [
  'open',
  'all',
  'setup',
  'drafting',
  'active',
  'complete',
  'archived',
] as const;
export const LEAGUE_STATUS_LABELS: Readonly<Record<string, string>> = {
  open: 'Open',
  all: 'All statuses',
  setup: 'Setup',
  drafting: 'Drafting',
  active: 'Active',
  complete: 'Completed',
  archived: 'Archived',
};
export interface LeagueCursor {
  at: string;
  id: string;
}
export interface AdminLeagueSummary {
  currentSeasonId: string | null;
  currentSeasonLabel: string | null;
  openCount: number;
  seasons: string[];
}
export interface AdminLeagueRow {
  id: string;
  name: string;
  status: LeagueStatus;
  created_at: string;
  commissioner: string;
  max_members: number;
  member_count: number;
  season_label: string;
}
export interface AdminLeaguePage {
  filteredCount: number;
  totalCount: number;
  items: AdminLeagueRow[];
  hasMore: boolean;
  nextCursor: LeagueCursor | null;
}
export interface AdminLeagueTeam {
  id: string;
  name: string;
  owner_id: string | null;
  owner_name: string;
}
export interface AdminLeagueHeader extends Omit<AdminLeagueRow, 'member_count'> {
  format: string;
  roster_format: string;
  ruleset_name: string;
  ruleset_version: number;
  draft_status: string | null;
  draft_mode: string | null;
  draft_scheduled_for: string | null;
  draft_pick_seconds: number | null;
  free_agents_enabled: boolean | null;
  waivers_enabled: boolean | null;
  trades_enabled: boolean | null;
}
export interface AdminLeagueMember {
  user_id: string;
  display_name: string;
  email: string | null;
  account_status: string;
  role: string;
  joined_at: string;
  is_varsity: boolean;
  team_name: string | null;
}
export interface AdminLeagueStanding {
  fantasy_team_id: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  standing_points: number;
}
export interface AdminLeagueMatchup {
  id: string;
  period: number;
  home_team_id: string;
  away_team_id: string;
  home_points: number;
  away_points: number;
  status: string;
  starts_at: string;
  ends_at: string;
  stage: string;
}
export interface AdminLeagueSnapshot {
  league: AdminLeagueHeader;
  teams: AdminLeagueTeam[];
  section: LeagueSection;
  items: (AdminLeagueMember | AdminLeagueStanding | AdminLeagueMatchup)[];
}
export interface AdminLeagueRosterEntry {
  bio?: Record<string, unknown>;
  id: string;
  athlete_id: string;
  slot_code: string;
  status: string;
  display_name: string;
  position: string;
  jersey_number: string | null;
  program_name: string;
}

export function leagueFilterValues(value: string | undefined, fallback: string): string[] {
  if (value === undefined) return [fallback];
  return value === 'all' || value === ''
    ? []
    : [...new Set(value.split(',').filter(Boolean))].slice(0, 32);
}

export function groupLeagueMatchups(
  rows: readonly AdminLeagueMatchup[],
): [number, AdminLeagueMatchup[]][] {
  const groups = new Map<number, AdminLeagueMatchup[]>();
  for (const row of rows) {
    const group = groups.get(row.period);
    if (group) group.push(row);
    else groups.set(row.period, [row]);
  }
  return [...groups].sort(([left], [right]) => left - right);
}
export interface AdminLeagueMessage {
  id: string;
  author_id: string | null;
  author: string;
  body: string;
  created_at: string;
  hidden_at: string | null;
}
export interface AdminLeagueChatPage {
  items: AdminLeagueMessage[];
  hasMore: boolean;
  nextCursor: LeagueCursor | null;
}

export function adminDate(value: string | null): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : date.toLocaleString('en-CA', { timeZone: 'America/Toronto' });
}
