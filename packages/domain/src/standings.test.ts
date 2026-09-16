import { describe, expect, it } from 'vitest';

import { calculateStandings, generateRoundRobinSchedule } from './standings';
import type { MatchupResult } from './types';

const matchup: MatchupResult = {
  id: 'match',
  leagueId: 'league',
  period: 1,
  homeTeamId: 'a',
  awayTeamId: 'b',
  homePoints: 10,
  awayPoints: 20,
  status: 'final',
};

describe('calculateStandings', () => {
  it('ranks head-to-head leagues by result', () => {
    const rows = calculateStandings(
      'head_to_head',
      ['a', 'b'],
      [matchup],
      [
        { fantasyTeamId: 'a', points: 100 },
        { fantasyTeamId: 'b', points: 80 },
      ],
    );
    expect(rows[0]?.fantasyTeamId).toBe('b');
    expect(rows[0]?.wins).toBe(1);
  });

  it('ranks points leagues by cumulative points', () => {
    const rows = calculateStandings(
      'points_leaderboard',
      ['a', 'b'],
      [matchup],
      [
        { fantasyTeamId: 'a', points: 100 },
        { fantasyTeamId: 'b', points: 80 },
      ],
    );
    expect(rows[0]?.fantasyTeamId).toBe('a');
  });
});

describe('generateRoundRobinSchedule', () => {
  it('pairs every even-sized league team once per cycle', () => {
    const schedule = generateRoundRobinSchedule(['a', 'b', 'c', 'd']);
    expect(schedule).toHaveLength(6);
    expect(
      new Set(schedule.map((pairing) => [pairing.homeTeamId, pairing.awayTeamId].sort().join(':')))
        .size,
    ).toBe(6);
  });

  it('gives odd-sized leagues one bye per round', () => {
    const schedule = generateRoundRobinSchedule(['a', 'b', 'c']);
    expect(schedule).toHaveLength(3);
    expect(
      schedule.every(
        (pairing) => pairing.homeTeamId !== '__bye__' && pairing.awayTeamId !== '__bye__',
      ),
    ).toBe(true);
  });
});
