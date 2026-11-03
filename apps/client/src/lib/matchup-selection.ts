import type { MatchupResult } from '@brock-fantasy/domain';

export function selectMyMatchup(
  rows: readonly MatchupResult[],
  teamId: string | null,
  now = Date.now(),
): MatchupResult | undefined {
  if (!teamId) return undefined;
  // - Inspect each pairing once without sorting the complete league schedule
  let current: MatchupResult | undefined,
    undatedActive: MatchupResult | undefined,
    next: MatchupResult | undefined,
    previous: MatchupResult | undefined;
  for (const row of rows) {
    if (row.homeTeamId !== teamId && row.awayTeamId !== teamId) continue;
    // - Retain status-based fallbacks only for legacy records with no calendar fields
    if (!row.startsAt && !row.endsAt) {
      if (row.status === 'active' && (!undatedActive || row.period < undatedActive.period))
        undatedActive = row;
      if (row.status === 'scheduled' && (!next || (!next.startsAt && row.period < next.period)))
        next = row;
      if (
        row.status === 'final' &&
        (!previous || (!previous.endsAt && row.period > previous.period))
      )
        previous = row;
      continue;
    }
    const start = Date.parse(row.startsAt ?? '');
    const end = Date.parse(row.endsAt ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) continue;
    // - Compare absolute instants from timestamptz values including Toronto DST offsets
    // - Keep the stored operational status even when the calendar identifies another period
    if (start <= now && now < end && (!current || start > Date.parse(current.startsAt!)))
      current = row;
    if (
      start > now &&
      row.status === 'scheduled' &&
      (!next?.startsAt || start < Date.parse(next.startsAt))
    )
      next = row;
    if (end <= now && (!previous?.endsAt || end > Date.parse(previous.endsAt))) previous = row;
  }
  // - During breaks show the next scheduled matchup or the latest ended matchup
  return current ?? undatedActive ?? next ?? previous;
}

export function matchupHeading(row: MatchupResult, now = Date.now()): string {
  if (row.startsAt && Date.parse(row.startsAt) > now) return 'Upcoming matchup';
  if (row.endsAt && Date.parse(row.endsAt) <= now) return 'Latest matchup';
  return 'Current matchup';
}

export function nextMatchupBoundary(rows: readonly MatchupResult[], now: number): number {
  let boundary = Infinity;
  for (const row of rows) {
    for (const value of [row.startsAt, row.endsAt]) {
      const time = Date.parse(value ?? '');
      if (time > now && time < boundary) boundary = time;
    }
  }
  return boundary;
}
