import type { MatchupResult } from '@brock-fantasy/domain';

export function selectMyMatchup(
  rows: readonly MatchupResult[],
  teamId: string | null,
): MatchupResult | undefined {
  if (!teamId) return undefined;
  const now = Date.now();
  // - Inspect each pairing once without sorting the complete league schedule
  let active: MatchupResult | undefined,
    next: MatchupResult | undefined,
    previous: MatchupResult | undefined;
  for (const row of rows) {
    if (teamId && row.homeTeamId !== teamId && row.awayTeamId !== teamId) continue;
    const underway =
      row.startsAt &&
      row.endsAt &&
      Date.parse(row.startsAt) <= now &&
      Date.parse(row.endsAt) > now &&
      row.status !== 'final';
    if ((row.status === 'active' || underway) && (!active || row.period < active.period))
      active = row;
    if (
      row.status === 'scheduled' &&
      (!row.startsAt || Date.parse(row.startsAt) > now) &&
      (!next || row.period < next.period)
    )
      next = row;
    if (row.status === 'final' && (!previous || row.period > previous.period)) previous = row;
  }
  return active ?? next ?? previous;
}
