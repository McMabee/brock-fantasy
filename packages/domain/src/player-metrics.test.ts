import { describe, expect, it } from 'vitest';
import { formatHeight, normalizeHeight, playerMetrics } from './player-metrics';

describe('supplied player metrics', () => {
  it('normalizes official heights and converts to both units', () => {
    expect(normalizeHeight('6\'2"')).toEqual({ inches: 74, centimetres: 187.96 });
    expect(normalizeHeight('5-11')).toEqual({ inches: 71, centimetres: 180.34 });
    expect(normalizeHeight('5′10″')).toEqual({ inches: 70, centimetres: 177.8 });
    expect(formatHeight(74)).toBe('6′2″ · 188 cm');
    for (const input of ['', 'N/A', '6\'12"', 'unknown', '188', '0-5'])
      expect(normalizeHeight(input)).toBeNull();
  });
  it('preserves zero and negative supplied projections without calculated ADP fallback', () => {
    for (const points of [0, -4, 218]) {
      const value = playerMetrics(
        { height: { inches: 74 } },
        [
          {
            season_label: '2026-27',
            kind: 'supplied_projection',
            fantasy_points: points,
            games_played: 0,
            supplied_adp: null,
          },
        ],
        '2026-27',
      );
      expect(value.projectedPoints).toBe(points);
      expect(value.projectedGames).toBe(0);
      expect(value.suppliedAdp).toBeNull();
    }
  });
  it('rejects invalid heights, conflicting summaries and unavailable values', () => {
    const summary = {
      season_label: '2026-27',
      kind: 'supplied_projection',
      fantasy_points: 3,
      games_played: null,
    };
    expect(playerMetrics({ height: { inches: 74.5 } }, [], '2026-27').heightInches).toBeNull();
    expect(
      playerMetrics({}, [summary, { ...summary, fantasy_points: 4 }], '2026-27').projectedPoints,
    ).toBeNull();
    expect(
      playerMetrics({}, [{ ...summary, kind: 'historical' }], '2026-27').projectedPoints,
    ).toBeNull();
    expect(playerMetrics({}, [{ ...summary, supplied_adp: 12.5 }], '2026-27').suppliedAdp).toBe(
      12.5,
    );
  });
});
