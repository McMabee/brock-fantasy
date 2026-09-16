import type { Athlete, DraftState, UUID } from './types';

export function buildSnakeOrder(teamIds: readonly UUID[], rounds: number): readonly UUID[] {
  if (teamIds.length < 2) throw new Error('A draft requires at least two fantasy teams.');
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('Draft rounds must be positive.');

  return Array.from({ length: rounds }, (_, roundIndex) =>
    roundIndex % 2 === 0 ? teamIds : [...teamIds].reverse(),
  ).flat();
}

export function currentDraftTeamId(state: DraftState): UUID | null {
  if (state.status !== 'active') return null;
  const order = buildSnakeOrder(state.teamIdsInDraftOrder, state.rounds);
  return order[state.currentOverallPick - 1] ?? null;
}

export interface AutopickInput {
  queuedAthleteIds: readonly UUID[];
  rankedAthleteIds: readonly UUID[];
  athletes: readonly Athlete[];
  alreadyDraftedAthleteIds: ReadonlySet<UUID>;
  isLegal: (athlete: Athlete) => boolean;
}

export function selectAutopick(input: AutopickInput): Athlete | null {
  const candidates = [...input.queuedAthleteIds, ...input.rankedAthleteIds];
  const seen = new Set<UUID>();

  for (const athleteId of candidates) {
    if (seen.has(athleteId)) continue;
    seen.add(athleteId);
    if (input.alreadyDraftedAthleteIds.has(athleteId)) continue;
    const athlete = input.athletes.find((item) => item.id === athleteId);
    if (athlete?.status === 'active' && input.isLegal(athlete)) return athlete;
  }

  return null;
}
