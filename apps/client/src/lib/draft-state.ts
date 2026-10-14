import type {
  Athlete,
  DraftCandidate,
  DraftPick,
  DraftSlot,
  DraftState,
  FantasyTeam,
} from '@brock-fantasy/domain';

export interface DraftPlayer extends Athlete {
  positions: readonly string[];
  program: string;
  rank: number;
  bio: Record<string, unknown>;
  summaries: readonly {
    season_label: string;
    kind: string;
    fantasy_points: number | null;
    games_played: number | null;
    stats: Record<string, number | null>;
  }[];
}
export interface DraftRoster {
  fantasy_team_id: string;
  athlete_id: string;
  slot_code: string;
  status: string;
}
export interface DraftSnapshot {
  revision: string;
  poolRevision: string;
  serverTime: string;
  unchanged: boolean;
  draft?: {
    id: string;
    league_id: string;
    status: DraftState['status'];
    rounds: number;
    current_overall_pick: number;
    pick_deadline: string | null;
    state_version: number;
    team_order: string[];
  };
  league?: { id: string; name: string; pool_id: string };
  teams?: {
    id: string;
    league_id: string;
    owner_id: string | null;
    name: string;
    draft_position: number;
  }[];
  picks?: {
    id: string;
    draft_id: string;
    fantasy_team_id: string;
    athlete_id: string;
    overall_pick: number;
    round: number;
    pick_in_round: number;
    source: DraftPick['source'];
    created_at: string;
  }[];
  roster?: DraftRoster[];
  queue?: string[];
  myTeamId?: string | null;
  slots?: (DraftSlot & { label: string })[];
  candidates?: DraftCandidate[];
  players?: {
    id: string;
    competition_id: string;
    team_id: string;
    display_name: string;
    position: string;
    jersey_number: string | null;
    status: Athlete['status'];
    bio: DraftPlayer['bio'];
    positions: string[];
    program: string;
    rank: number;
    summaries: DraftPlayer['summaries'];
  }[];
  legalAthleteIds?: string[];
}
export interface DraftViewState {
  draft: DraftState | null;
  leagueName: string;
  teams: readonly FantasyTeam[];
  athletes: readonly DraftPlayer[];
  picks: readonly DraftPick[];
  rankings: ReadonlyMap<string, number>;
  queuedAthleteIds: readonly string[];
  myTeamId: string | null;
  roster: readonly DraftRoster[];
  slots: readonly (DraftSlot & { label: string })[];
  candidates: readonly DraftCandidate[];
  legalAthleteIds: ReadonlySet<string>;
  serverOffset: number;
  loading: boolean;
  connected: boolean;
  error: string | null;
  reload: () => Promise<boolean>;
}
