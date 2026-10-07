import type { DivisionCode, SportCode, UUID } from './types';

export const BETA_RULE_VERSION = 'brock-2026.2';
export const BETA_SEASON = '2026-27';
export const BETA_PLAYER_POOL_ID = 'b0000000-0000-4000-8000-000000000003';
export const LEAGUE_SIZES = [4, 6, 8, 10] as const;
export type BetaPosition = 'F' | 'D' | 'G' | 'BC' | 'FC' | 'HT' | 'S' | 'L';
export type BetaSlot = 'HK_F' | 'HK_DG' | 'BB_BC' | 'BB_FC' | 'VB_HT' | 'VB_LS' | 'BN';
export const BETA_SLOTS: Readonly<Record<BetaSlot, readonly BetaPosition[]>> = {
  HK_F: ['F'],
  HK_DG: ['D', 'G'],
  BB_BC: ['BC'],
  BB_FC: ['FC'],
  VB_HT: ['HT'],
  VB_LS: ['L', 'S'],
  BN: ['F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S'],
};
export const STARTER_SLOTS = Object.keys(BETA_SLOTS).filter((s) => s !== 'BN') as BetaSlot[];

export interface AthleteSeason {
  athleteId: UUID;
  season: string;
  sport: SportCode;
  division: DivisionCode;
  teamId: UUID;
  positions: readonly BetaPosition[];
  draftEligible: boolean;
}
export interface FantasyPeriod {
  number: number;
  startsAt: string;
  endsAt: string;
  phase: 'regular' | 'semifinal' | 'final';
}
// End timestamps are exclusive. Toronto changes from UTC-4 to UTC-5 on Nov 1.
export const BETA_PERIODS: readonly FantasyPeriod[] = [
  ['2026-10-24T04:00:00Z', '2026-11-01T04:00:00Z'],
  ['2026-11-01T04:00:00Z', '2026-11-14T05:00:00Z'],
  ['2026-11-14T05:00:00Z', '2026-11-22T05:00:00Z'],
  ['2026-11-22T05:00:00Z', '2026-11-30T05:00:00Z'],
  ['2027-01-08T05:00:00Z', '2027-01-15T05:00:00Z'],
  ['2027-01-15T05:00:00Z', '2027-01-23T05:00:00Z'],
  ['2027-01-23T05:00:00Z', '2027-01-29T05:00:00Z'],
  ['2027-01-29T05:00:00Z', '2027-02-06T05:00:00Z'],
  ['2027-02-06T05:00:00Z', '2027-02-13T05:00:00Z'],
  ['2027-02-13T05:00:00Z', '2027-02-21T05:00:00Z'],
].map(([startsAt, endsAt], i) => ({
  number: i + 1,
  startsAt: startsAt!,
  endsAt: endsAt!,
  phase: i < 8 ? 'regular' : i === 8 ? 'semifinal' : 'final',
}));
export const TRADE_DEADLINE = '2027-01-23T17:00:00Z';

export function normalizePositions(sport: SportCode, input: string): BetaPosition[] {
  const aliases: Record<SportCode, Record<string, BetaPosition>> = {
    hockey: {
      f: 'F',
      forward: 'F',
      c: 'F',
      lw: 'F',
      rw: 'F',
      d: 'D',
      defence: 'D',
      defense: 'D',
      defenceman: 'D',
      g: 'G',
      gk: 'G',
      goalie: 'G',
      goaltender: 'G',
    },
    basketball: {
      g: 'BC',
      guard: 'BC',
      pg: 'BC',
      sg: 'BC',
      bc: 'BC',
      f: 'FC',
      forward: 'FC',
      c: 'FC',
      centre: 'FC',
      center: 'FC',
      pf: 'FC',
      sf: 'FC',
      fc: 'FC',
    },
    volleyball: {
      ht: 'HT',
      oh: 'HT',
      'outside hitter': 'HT',
      outside: 'HT',
      opposite: 'HT',
      'opposite hitter': 'HT',
      rs: 'HT',
      'right side': 'HT',
      middle: 'HT',
      'middle blocker': 'HT',
      mb: 'HT',
      mh: 'HT',
      s: 'S',
      setter: 'S',
      l: 'L',
      libero: 'L',
    },
  };
  return [
    ...new Set(
      input
        .toLowerCase()
        .split(/\s*[/,;]\s*/)
        .map((v) => aliases[sport][v.trim()])
        .filter((v): v is BetaPosition => Boolean(v)),
    ),
  ];
}

export const STAT_WEIGHTS = {
  skater: {
    goals: 20,
    assists: 10,
    power_play_goals: 5,
    short_handed_goals: 5,
    penalty_minutes: -1,
    multi_point: 5,
  },
  goalie: { wins: 10, goals_allowed: -2, saves: 0.4, shutouts: 15 },
  basketball: {
    points: 1,
    offensive_rebounds: 1.5,
    defensive_rebounds: 1,
    assists: 1,
    blocks: 2,
    steals: 2,
    turnovers: -2,
    fouls: -1,
    foul_out: -3,
    double_double: 2,
  },
  volleyball: {
    kills: 2,
    aces: 2,
    solo_blocks: 1.5,
    assisted_blocks: 1,
    assists: 0.25,
    digs: 0.25,
    errors: -1,
    hitter_bonus: 2,
    setter_bonus: 4,
    libero_bonus: 8,
  },
} as const;
export const VOLLEYBALL_ERRORS = [
  'attack_errors',
  'service_errors',
  'reception_errors',
  'setting_errors',
  'ball_handling_errors',
  'blocking_errors',
] as const;
const DERIVED = new Set([
  'shutouts',
  'multi_point',
  'double_double',
  'hitter_bonus',
  'setter_bonus',
  'libero_bonus',
]);
export type StatCategory = keyof typeof STAT_WEIGHTS;
export interface BetaScore {
  category: StatCategory;
  complete: boolean;
  missing: string[];
  total: number | null;
  normalized: Record<string, number>;
  breakdown: { key: string; value: number; weight: number; points: number }[];
}
export function scoreBetaGame(
  sport: SportCode,
  positions: readonly BetaPosition[],
  input: Readonly<Record<string, number | null | undefined>>,
): BetaScore {
  const category: StatCategory =
    sport === 'hockey' ? (positions.includes('G') ? 'goalie' : 'skater') : sport;
  const weights: Readonly<Record<string, number>> = STAT_WEIGHTS[category];
  const normalized: Record<string, number> = {};
  const missing: string[] = [];
  for (const key of Object.keys(weights).filter((key) => !DERIVED.has(key))) {
    const value = input[key];
    if (category === 'volleyball' && key === 'errors') {
      if (VOLLEYBALL_ERRORS.every((error) => input[error] != null)) {
        normalized.errors = VOLLEYBALL_ERRORS.reduce((sum, error) => sum + input[error]!, 0);
        if (value != null && value !== normalized.errors)
          throw new Error('Aggregate errors must equal all individual error categories');
      } else if (value != null) normalized.errors = value;
      else for (const error of VOLLEYBALL_ERRORS) if (input[error] == null) missing.push(error);
    } else if (value == null) missing.push(key);
    else normalized[key] = value;
  }
  if (category === 'goalie') {
    for (const key of ['losses', 'full_game_solo', 'shootout']) {
      if (input[key] == null) missing.push(key);
      else normalized[key] = input[key]!;
    }
  }
  for (const [key, value] of Object.entries(input)) {
    if (value != null && (!Number.isFinite(value) || value < 0))
      throw new Error(`Invalid statistic: ${key}`);
  }
  for (const flag of ['wins', 'losses', 'shutouts', 'full_game_solo', 'shootout', 'foul_out']) {
    const value = input[flag];
    if (value != null && ![0, 1].includes(value)) throw new Error(`${flag} must be 0 or 1`);
  }
  if (category === 'goalie') {
    if ((normalized.wins ?? 0) + (normalized.losses ?? 0) > 1)
      throw new Error('A goalie cannot receive both a win and a loss');
    if (['full_game_solo', 'shootout', 'goals_allowed'].every((key) => normalized[key] != null)) {
      normalized.shutouts =
        normalized.full_game_solo === 1 &&
        (normalized.shootout === 1 || normalized.goals_allowed === 0)
          ? 1
          : 0;
      if (input.shutouts != null && input.shutouts !== normalized.shutouts)
        throw new Error('Shutout credit conflicts with full-game solo participation');
    }
  }
  if (category === 'skater')
    normalized.multi_point = (normalized.goals ?? 0) + (normalized.assists ?? 0) >= 2 ? 1 : 0;
  if (category === 'basketball')
    normalized.double_double =
      [
        normalized.points ?? 0,
        (normalized.offensive_rebounds ?? 0) + (normalized.defensive_rebounds ?? 0),
        normalized.assists ?? 0,
        normalized.steals ?? 0,
        normalized.blocks ?? 0,
      ].filter((v) => v >= 10).length >= 2
        ? 1
        : 0;
  if (category === 'volleyball') {
    normalized.hitter_bonus = positions.includes('HT') && (normalized.kills ?? 0) >= 10 ? 1 : 0;
    normalized.setter_bonus = positions.includes('S') && (normalized.assists ?? 0) >= 40 ? 1 : 0;
    normalized.libero_bonus = positions.includes('L') && (normalized.digs ?? 0) >= 8 ? 1 : 0;
  }
  const breakdown = Object.entries(weights)
    .filter(([key]) => normalized[key] !== undefined)
    .map(([key, weight]) => ({
      key,
      weight,
      value: normalized[key]!,
      points: Math.round(normalized[key]! * weight * 1000) / 1000,
    }));
  return {
    category,
    complete: missing.length === 0,
    missing,
    normalized,
    breakdown,
    total: missing.length
      ? null
      : Math.round(breakdown.reduce((sum, b) => sum + b.points, 0) * 1000) / 1000,
  };
}

export function weightedAutopick<T>(rankedLegal: readonly T[], random: number): T | null {
  if (!Number.isFinite(random) || random < 0 || random >= 1)
    throw new Error('Random value must be in [0,1).');
  const candidates = rankedLegal.slice(0, 5);
  let draw = random * candidates.reduce((sum, _, i) => sum + 5 - i, 0);
  for (let i = 0; i < candidates.length; i++) {
    draw -= 5 - i;
    if (draw < 0) return candidates[i]!;
  }
  return null;
}

/** Bipartite matching prevents a flexible athlete from consuming the only legal scarce slot. */
export function rosterCanComplete(
  athletes: readonly { id: string; positions: readonly BetaPosition[] }[],
  slots: readonly BetaSlot[],
): boolean {
  const owners = new Map<string, number>();
  function assign(index: number, seen: Set<string>): boolean {
    for (const a of athletes) {
      if (seen.has(a.id) || !a.positions.some((p) => BETA_SLOTS[slots[index]!].includes(p)))
        continue;
      seen.add(a.id);
      const previous = owners.get(a.id);
      if (previous === undefined || assign(previous, seen)) {
        owners.set(a.id, index);
        return true;
      }
    }
    return false;
  }
  return slots.every((_, index) => assign(index, new Set()));
}

export function roundRobin(
  teamIds: readonly string[],
  periods = 8,
): { period: number; home: string; away: string }[] {
  if (
    !(LEAGUE_SIZES as readonly number[]).includes(teamIds.length) ||
    new Set(teamIds).size !== teamIds.length
  )
    throw new Error('Choose 4, 6, 8, or 10 distinct teams.');
  const rotation = [...teamIds];
  const schedule: { period: number; home: string; away: string }[] = [];
  for (let period = 1; period <= periods; period++) {
    for (let i = 0; i < rotation.length / 2; i++) {
      const pair = [rotation[i]!, rotation[rotation.length - 1 - i]!] as const;
      schedule.push({ period, home: pair[period % 2 ? 0 : 1], away: pair[period % 2 ? 1 : 0] });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  return schedule;
}
export function tradeVetoThreshold(teams: number): number {
  if (!(LEAGUE_SIZES as readonly number[]).includes(teams))
    throw new Error('Unsupported league size.');
  return Math.min(4, Math.floor((teams - 2) / 2) + 1);
}
export function periodAt(
  time: string,
  periods: readonly FantasyPeriod[] = BETA_PERIODS,
): FantasyPeriod | null {
  const ms = Date.parse(time);
  return periods.find((p) => Date.parse(p.startsAt) <= ms && ms < Date.parse(p.endsAt)) ?? null;
}

export interface ProjectionInput {
  athleteId: UUID;
  period: FantasyPeriod;
  ruleVersion: string;
  inputCutoff: string;
  games: readonly { id: UUID; startsAt: string; knownAt: string }[];
  history: readonly { gameId: UUID; startsAt: string; knownAt: string; points: number }[];
}
export interface WeeklyProjection {
  athleteId: UUID;
  period: number;
  points: number | null;
  modelVersion: string;
  inputCutoff: string;
  generatedAt: string;
  status: 'unavailable' | 'ready';
}
export interface ProjectionProvider {
  version: string;
  project(input: ProjectionInput): Promise<WeeklyProjection>;
}
export function projectionInputsAsOf(input: ProjectionInput): ProjectionInput {
  const cutoff = Date.parse(input.inputCutoff);
  if (!Number.isFinite(cutoff) || cutoff > Date.parse(input.period.startsAt))
    throw new Error('Projection cutoff must precede the fantasy period.');
  return {
    ...input,
    games: input.games.filter((g) => Date.parse(g.knownAt) <= cutoff),
    history: input.history.filter(
      (g) => Date.parse(g.knownAt) <= cutoff && Date.parse(g.startsAt) < cutoff,
    ),
  };
}
export const unavailableProjectionProvider: ProjectionProvider = {
  version: 'unavailable-v1',
  project(input) {
    projectionInputsAsOf(input);
    return Promise.resolve({
      athleteId: input.athleteId,
      period: input.period.number,
      points: null,
      modelVersion: this.version,
      inputCutoff: input.inputCutoff,
      generatedAt: new Date().toISOString(),
      status: 'unavailable',
    });
  },
};
