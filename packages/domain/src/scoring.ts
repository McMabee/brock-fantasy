import type { NumericStatLine, ScoringRule } from './types';

export interface ScoringBreakdownItem {
  statKey: string;
  statValue: number;
  pointsPerUnit: number;
  points: number;
}

export interface ScoringResult {
  total: number;
  breakdown: readonly ScoringBreakdownItem[];
}

const roundPoints = (value: number): number => Math.round((value + Number.EPSILON) * 1_000) / 1_000;

export function scoreStatLine(
  statLine: NumericStatLine,
  rules: readonly ScoringRule[],
): ScoringResult {
  const breakdown = rules.map((rule) => {
    const statValue = statLine[rule.statKey] ?? 0;
    return {
      statKey: rule.statKey,
      statValue,
      pointsPerUnit: rule.points,
      points: roundPoints(statValue * rule.points),
    };
  });

  return {
    total: roundPoints(breakdown.reduce((total, item) => total + item.points, 0)),
    breakdown,
  };
}

export interface ScoringDelta {
  statKey: string;
  previousPoints: number;
  targetPoints: number;
  delta: number;
}

export function calculateCorrectionDeltas(
  previous: NumericStatLine,
  corrected: NumericStatLine,
  rules: readonly ScoringRule[],
): readonly ScoringDelta[] {
  const previousScore = scoreStatLine(previous, rules);
  const correctedScore = scoreStatLine(corrected, rules);

  return correctedScore.breakdown
    .map((item, index) => {
      const previousItem = previousScore.breakdown[index];
      const previousPoints = previousItem?.points ?? 0;
      return {
        statKey: item.statKey,
        previousPoints,
        targetPoints: item.points,
        delta: roundPoints(item.points - previousPoints),
      };
    })
    .filter((item) => item.delta !== 0);
}
