import assert from 'node:assert/strict';
import test from 'node:test';
import { scoringRow } from './brock-approvals.mjs';

test('scoring prefixes retain sport/role attribution, fractional/negative weights and units', () => {
  const issues = [];
  const result = scoringRow(
    {
      'Volleyball(V_b)': 'Assists (A) = 0.25',
      'Hockey Skater(H_s)': 'Penalty Minutes (PIM) = -1/min',
      'Basketball(B_b)': 'Assist (A) = 1',
      'Hockey Goalie(H_g)': 'Save (SV) = 0.4',
    },
    6,
    issues,
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(
    result.coefficients.map(({ categorySymbol, role, coefficient, unit }) => ({
      categorySymbol,
      role,
      coefficient,
      unit,
    })),
    [
      { categorySymbol: 'V_b', role: 'volleyball', coefficient: 0.25, unit: 'per_stat_or_bonus' },
      { categorySymbol: 'H_s', role: 'skater', coefficient: -1, unit: 'per_minute' },
      { categorySymbol: 'B_b', role: 'basketball', coefficient: 1, unit: 'per_stat_or_bonus' },
      { categorySymbol: 'H_g', role: 'goalie', coefficient: 0.4, unit: 'per_stat_or_bonus' },
    ],
  );
  assert.ok(result.coefficients.every((item) => item.categoryMultiplier === null));
  scoringRow({ 'Volleyball(V_b)': 'Kills (K) = unknown' }, 2, issues);
  assert.equal(issues[0].code, 'SCORING_COEFFICIENT');
});
