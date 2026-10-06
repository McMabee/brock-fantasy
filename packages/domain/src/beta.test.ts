import { describe, expect, it } from 'vitest';
import {
  BETA_PERIODS,
  BETA_SLOTS,
  normalizePositions,
  periodAt,
  projectionInputsAsOf,
  rosterCanComplete,
  roundRobin,
  scoreBetaGame,
  tradeVetoThreshold,
  weightedAutopick,
} from './beta';

describe('approved beta rules', () => {
  it('scores additive skater bonuses and removes them on corrections', () => {
    const base = {
      goals: 1,
      assists: 1,
      power_play_goals: 1,
      short_handed_goals: 0,
      penalty_minutes: 2,
    };
    expect(scoreBetaGame('hockey', ['F'], base).total).toBe(38);
    expect(scoreBetaGame('hockey', ['D'], { ...base, assists: 0 }).total).toBe(23);
    expect(
      scoreBetaGame('hockey', ['G'], { wins: 1, goals_allowed: 0, saves: 25, shutouts: 1 }).total,
    ).toBe(35);
    expect(scoreBetaGame('hockey', ['G'], { goals_allowed: 0, saves: 25 }).missing).toEqual([
      'wins',
      'shutouts',
    ]);
  });
  it('uses all individual volleyball errors without double counting aggregate errors', () => {
    const line = {
      kills: 10,
      aces: 2,
      solo_blocks: 1,
      assisted_blocks: 2,
      assists: 40,
      digs: 8,
      attack_errors: 1,
      service_errors: 2,
      reception_errors: 3,
      setting_errors: 0,
      ball_handling_errors: 4,
      blocking_errors: 5,
    };
    expect(scoreBetaGame('volleyball', ['HT'], line).total).toBe(26.5);
    expect(scoreBetaGame('volleyball', ['S'], line).total).toBe(28.5);
    expect(scoreBetaGame('volleyball', ['L'], line).total).toBe(32.5);
    expect(scoreBetaGame('volleyball', ['HT'], { ...line, errors: 15 }).total).toBe(26.5);
    expect(
      scoreBetaGame('volleyball', ['HT'], { ...line, blocking_errors: null }).total,
    ).toBeNull();
    expect(
      scoreBetaGame('volleyball', ['HT'], { ...line, setting_errors: null }).missing,
    ).toContain('setting_errors');
    expect(scoreBetaGame('volleyball', ['HT'], { ...line, kills: 9 }).normalized.hitter_bonus).toBe(
      0,
    );
  });
  it('scores one double-double, total rebounds, and additive foul-out', () => {
    const line = {
      points: 10,
      offensive_rebounds: 2,
      defensive_rebounds: 8,
      assists: 10,
      blocks: 1,
      steals: 2,
      turnovers: 3,
      fouls: 5,
      foul_out: 1,
    };
    expect(scoreBetaGame('basketball', ['BC'], line).total).toBe(25);
    expect(
      scoreBetaGame('basketball', ['BC'], { ...line, points: 9, assists: 9 }).normalized
        .double_double,
    ).toBe(0);
    expect(() => scoreBetaGame('basketball', ['BC'], { ...line, fouls: -1 })).toThrow();
  });
  it('keeps periods exclusive at their ends and handles the winter gap and DST', () => {
    expect(periodAt('2026-11-01T04:00:00Z')?.number).toBe(2);
    expect(periodAt('2026-12-25T12:00:00Z')).toBeNull();
    expect(periodAt('2027-02-21T05:00:00Z')).toBeNull();
    expect(BETA_PERIODS).toHaveLength(10);
  });
  it.each([4, 6, 8, 10])('generates complete matchups and veto thresholds for %i teams', (size) => {
    const teams = Array.from({ length: size }, (_, i) => String(i));
    const games = roundRobin(teams);
    expect(games).toHaveLength(size * 4);
    for (let period = 1; period <= 8; period++)
      expect(
        new Set(games.filter((g) => g.period === period).flatMap((g) => [g.home, g.away])).size,
      ).toBe(size);
    const firstCycle = games.filter((g) => g.period <= Math.min(8, size - 1));
    expect(new Set(firstCycle.map((g) => [g.home, g.away].sort().join(':'))).size).toBe(
      firstCycle.length,
    );
    expect(tradeVetoThreshold(size)).toBe(size === 4 ? 2 : size === 6 ? 3 : 4);
  });
  it('normalizes sports separately and checks scarce and flexible positions', () => {
    expect(normalizePositions('basketball', 'G/F')).toEqual(['BC', 'FC']);
    expect(normalizePositions('hockey', 'GK')).toEqual(['G']);
    expect(normalizePositions('volleyball', 'Middle/Setter')).toEqual(['HT', 'S']);
    const athletes = [
      { id: 'a', positions: ['BC', 'FC'] as const },
      { id: 'b', positions: ['BC'] as const },
    ];
    expect(rosterCanComplete(athletes, ['BB_BC', 'BB_FC'])).toBe(true);
    expect(rosterCanComplete(athletes, ['BB_BC', 'VB_LS'])).toBe(false);
    expect(Object.keys(BETA_SLOTS)).toHaveLength(7);
  });
  it('weights the top five and rejects invalid RNG values', () => {
    expect(weightedAutopick(['a', 'b', 'c', 'd', 'e', 'f'], 0)).toBe('a');
    expect(weightedAutopick(['a', 'b', 'c', 'd', 'e', 'f'], 0.99)).toBe('e');
    expect(weightedAutopick([], 0.5)).toBeNull();
    expect(() => weightedAutopick(['a'], 1)).toThrow();
  });
  it('prevents future-result and correction leakage into backtests', () => {
    const result = projectionInputsAsOf({
      athleteId: 'a',
      period: BETA_PERIODS[1]!,
      ruleVersion: 'v1',
      inputCutoff: '2026-10-31T00:00:00Z',
      games: [],
      history: [
        {
          gameId: 'old',
          startsAt: '2026-10-24T00:00:00Z',
          knownAt: '2026-10-25T00:00:00Z',
          points: 10,
        },
        {
          gameId: 'corrected-later',
          startsAt: '2026-10-24T00:00:00Z',
          knownAt: '2026-11-02T00:00:00Z',
          points: 30,
        },
      ],
    });
    expect(result.history.map((h) => h.gameId)).toEqual(['old']);
  });
});
