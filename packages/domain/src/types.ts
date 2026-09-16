export type UUID = string;

export type SportCode = 'hockey' | 'basketball' | 'volleyball';
export type DivisionCode = 'mens' | 'womens';
export type LeagueFormat = 'head_to_head' | 'points_leaderboard';
export type LeagueStatus = 'setup' | 'drafting' | 'active' | 'complete' | 'archived';
export type UserRole = 'user' | 'commissioner' | 'admin';
export type DraftStatus = 'scheduled' | 'active' | 'paused' | 'complete';
export type MatchupStatus = 'scheduled' | 'active' | 'final';
export type RosterStatus = 'starter' | 'bench' | 'injured_reserve';

export interface Competition {
  id: UUID;
  sport: SportCode;
  division: DivisionCode;
  name: string;
  seasonLabel: string;
  isActive: boolean;
  rulesetId: UUID;
}

export interface ScoringRule {
  statKey: string;
  label: string;
  points: number;
}

export interface RosterSlotRule {
  slot: string;
  label: string;
  allowedPositions: readonly string[];
  count: number;
  isStarter: boolean;
}

export interface CompetitionRuleset {
  id: UUID;
  version: number;
  name: string;
  sport: SportCode;
  status: 'draft' | 'approved' | 'retired';
  scoringRules: readonly ScoringRule[];
  rosterSlots: readonly RosterSlotRule[];
  draft: {
    pickSeconds: number;
    autopickStrategy: 'queued_then_ranked_legal';
  };
  transactions: {
    freeAgentsEnabled: boolean;
    waiversEnabled: boolean;
    tradesEnabled: boolean;
    waiverProcessHourUtc: number;
  };
  matchup: {
    periodDays: number;
    tiesAllowed: boolean;
    tiebreaker: 'points_for' | 'bench_points' | 'none';
  };
}

export interface Athlete {
  id: UUID;
  competitionId: UUID;
  teamId: UUID;
  displayName: string;
  position: string;
  jerseyNumber?: string;
  status: 'active' | 'inactive' | 'unavailable';
}

export interface League {
  id: UUID;
  competitionId: UUID;
  commissionerId: UUID;
  name: string;
  format: LeagueFormat;
  status: LeagueStatus;
  rulesetId: UUID;
  maxMembers: number;
  inviteCode: string;
}

export interface FantasyTeam {
  id: UUID;
  leagueId: UUID;
  ownerId: UUID;
  name: string;
  draftPosition: number;
}

export interface RosterEntry {
  fantasyTeamId: UUID;
  athleteId: UUID;
  athletePosition: string;
  slot: string;
  status: RosterStatus;
  acquiredAt: string;
  releasedAt?: string;
}

export interface DraftPick {
  id: UUID;
  draftId: UUID;
  fantasyTeamId: UUID;
  athleteId: UUID;
  overallPick: number;
  round: number;
  pickInRound: number;
  source: 'manager' | 'autopick' | 'commissioner';
  createdAt: string;
}

export interface DraftState {
  id: UUID;
  leagueId: UUID;
  status: DraftStatus;
  rounds: number;
  currentOverallPick: number;
  pickDeadline?: string;
  teamIdsInDraftOrder: readonly UUID[];
  picks: readonly DraftPick[];
}

export type NumericStatLine = Readonly<Record<string, number>>;

export interface ProviderPlayerStat {
  providerAthleteId: string;
  athleteName: string;
  teamProviderId: string;
  position?: string;
  stats: NumericStatLine;
}

export interface ProviderStatSnapshot {
  provider: string;
  providerGameId: string;
  revision?: string;
  capturedAt: string;
  gameStatus: 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'cancelled';
  players: readonly ProviderPlayerStat[];
  raw: unknown;
}

export interface NormalizedPlayerGameStat {
  gameId: UUID;
  athleteId: UUID;
  sourceIdentity: string;
  stats: NumericStatLine;
}

export interface FantasyPointEvent {
  id: UUID;
  fantasyTeamId: UUID;
  athleteId: UUID;
  gameId: UUID;
  rulesetId: UUID;
  statKey: string;
  statValue: number;
  points: number;
  kind: 'score' | 'correction' | 'admin_adjustment';
  sourceIdentity: string;
  createdAt: string;
}

export interface MatchupResult {
  id: UUID;
  leagueId: UUID;
  period: number;
  homeTeamId: UUID;
  awayTeamId: UUID;
  homePoints: number;
  awayPoints: number;
  status: MatchupStatus;
}

export interface StandingsRow {
  fantasyTeamId: UUID;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  standingPoints: number;
}

export interface SyncResult {
  sourceIdentity: string;
  inserted: number;
  updated: number;
  ignored: number;
  errors: readonly string[];
}

export interface ProviderGameSnapshot {
  providerGameId: string;
  status: ProviderStatSnapshot['gameStatus'];
  startsAt: string;
  homeTeamProviderId: string;
  awayTeamProviderId: string;
  raw: unknown;
}
