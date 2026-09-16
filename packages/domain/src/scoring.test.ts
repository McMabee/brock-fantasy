import { describe, expect, it } from 'vitest';

import { calculateCorrectionDeltas, scoreStatLine } from './scoring';

const hockeyRules = [
  { statKey: 'goals', label: 'Goals', points: 3 },
  { statKey: 'assists', label: 'Assists', points: 2 },
  { statKey: 'shots', label: 'Shots', points: 0.5 },
] as const;

describe('scoreStatLine', () => {
  it('calculates a deterministic breakdown', () => {
    expect(scoreStatLine({ goals: 2, assists: 1, shots: 5 }, hockeyRules)).toEqual({
      total: 10.5,
      breakdown: [
        { statKey: 'goals', statValue: 2, pointsPerUnit: 3, points: 6 },
        { statKey: 'assists', statValue: 1, pointsPerUnit: 2, points: 2 },
        { statKey: 'shots', statValue: 5, pointsPerUnit: 0.5, points: 2.5 },
      ],
    });
  });

  it('treats missing statistics as zero', () => {
    expect(scoreStatLine({ goals: 1 }, hockeyRules).total).toBe(3);
  });

  it('emits compensating deltas for a correction and reversal', () => {
    const original = { goals: 1, assists: 1, shots: 3 };
    const corrected = { goals: 2, assists: 0, shots: 3 };
    const correction = calculateCorrectionDeltas(original, corrected, hockeyRules);
    const reversal = calculateCorrectionDeltas(corrected, original, hockeyRules);

    expect(correction).toEqual([
      { statKey: 'goals', previousPoints: 3, targetPoints: 6, delta: 3 },
      { statKey: 'assists', previousPoints: 2, targetPoints: 0, delta: -2 },
    ]);
    expect(reversal.map((item) => item.delta)).toEqual([-3, 2]);
  });
});
