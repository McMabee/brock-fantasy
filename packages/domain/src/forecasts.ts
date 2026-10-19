export interface ForecastGame {
  id: string;
  startsAt: string;
  status: string;
  pending: boolean;
  opponent: string;
  complete: boolean;
  actualPoints: number | null;
}
export interface ForecastPeriod {
  id: string;
  number: number;
  startsAt: string;
  endsAt: string;
}
export interface PlayerForecastSource {
  periods: ForecastPeriod[];
  games: ForecastGame[];
  projectedSeasonPoints: number | null;
  projectedGames: number | null;
  knownSchedule: boolean;
}
export function gameProjection(points: number | null, games: number | null): number | null {
  return points != null &&
    Number.isFinite(points) &&
    games != null &&
    Number.isFinite(games) &&
    games > 0
    ? points / games
    : null;
}
export function periodForecast(
  source: PlayerForecastSource,
  period: ForecastPeriod,
  now = Date.now(),
) {
  const baseline = gameProjection(source.projectedSeasonPoints, source.projectedGames);
  const start = Date.parse(period.startsAt),
    end = Date.parse(period.endsAt);
  let earned = 0,
    upcomingGames = 0,
    pendingGames = 0,
    scheduledGames = 0,
    schedulePending = false;
  // - Aggregate canonical player games once without joining fantasy-league observations
  const seen = new Set<string>();
  for (const game of source.games) {
    const time = Date.parse(game.startsAt);
    if (
      seen.has(game.id) ||
      time < start ||
      time >= end ||
      ['cancelled', 'postponed'].includes(game.status)
    )
      continue;
    seen.add(game.id);
    scheduledGames++;
    schedulePending ||= game.pending;
    if (
      game.complete &&
      game.actualPoints != null &&
      Number.isFinite(game.actualPoints) &&
      time <= now
    )
      earned += game.actualPoints;
    else if (time > now) upcomingGames++;
    else pendingGames++;
  }
  const estimate = (count: number) =>
    count === 0 && source.knownSchedule
      ? 0
      : baseline == null || !source.knownSchedule
        ? null
        : baseline * count;
  const upcoming = estimate(upcomingGames),
    pending = estimate(pendingGames);
  return {
    earned,
    upcoming,
    pending,
    total: upcoming == null || pending == null ? null : earned + upcoming + pending,
    upcomingGames,
    pendingGames,
    scheduledGames,
    schedulePending,
  };
}
