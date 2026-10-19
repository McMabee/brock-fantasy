import { describe, expect, it } from 'vitest';
import { gameProjection, periodForecast, type PlayerForecastSource } from './forecasts';

const period = {
  id: 'period',
  number: 1,
  startsAt: '2026-10-24T00:00:00Z',
  endsAt: '2026-11-01T00:00:00Z',
};
const now = Date.parse('2026-10-26T12:00:00Z');
const source: PlayerForecastSource = {
  periods: [period],
  projectedSeasonPoints: 200,
  projectedGames: 20,
  knownSchedule: true,
  games: [
    {
      id: 'earned',
      startsAt: '2026-10-24T12:00:00Z',
      status: 'final',
      pending: false,
      opponent: 'A',
      complete: true,
      actualPoints: 16,
    },
    {
      id: 'live',
      startsAt: '2026-10-26T11:00:00Z',
      status: 'in_progress',
      pending: false,
      opponent: 'B',
      complete: false,
      actualPoints: null,
    },
    {
      id: 'next',
      startsAt: '2026-10-28T12:00:00Z',
      status: 'scheduled',
      pending: true,
      opponent: 'C',
      complete: false,
      actualPoints: null,
    },
  ],
};
describe('player forecasts', () => {
  it('combines canonical actuals, upcoming estimates and pending-game estimates', () =>
    expect(periodForecast(source, period, now)).toMatchObject({
      earned: 16,
      upcoming: 10,
      pending: 10,
      total: 36,
      scheduledGames: 3,
      schedulePending: true,
    }));
  it('replaces pending estimates with complete actuals without double counting', () =>
    expect(
      periodForecast(
        {
          ...source,
          games: source.games.map((game) =>
            game.id === 'live' ? { ...game, complete: true, actualPoints: 7 } : game,
          ),
        },
        period,
        now,
      ),
    ).toMatchObject({ earned: 23, pending: 0, total: 33 }));
  it('ignores duplicate game observations, cancellations and postponements', () =>
    expect(
      periodForecast(
        {
          ...source,
          games: [
            ...source.games,
            source.games[0]!,
            { ...source.games[1]!, id: 'cancelled', status: 'cancelled' },
            { ...source.games[1]!, id: 'postponed', status: 'postponed' },
          ],
        },
        period,
        now,
      ).total,
    ).toBe(36));
  it('distinguishes known zero-game periods from missing schedules', () => {
    expect(periodForecast({ ...source, games: [], projectedGames: null }, period, now).total).toBe(
      0,
    );
    expect(
      periodForecast({ ...source, games: [], knownSchedule: false }, period, now).total,
    ).toBeNull();
  });
  it('preserves zero and negative estimates while rejecting invalid divisors', () => {
    expect(gameProjection(0, 10)).toBe(0);
    expect(gameProjection(-10, 2)).toBe(-5);
    expect(gameProjection(10, 0)).toBeNull();
    expect(gameProjection(Number.NaN, 1)).toBeNull();
  });
  it('uses half-open fantasy period boundaries', () =>
    expect(
      periodForecast(
        { ...source, games: [{ ...source.games[0]!, startsAt: period.endsAt }] },
        period,
        now,
      ).scheduledGames,
    ).toBe(0));
});
