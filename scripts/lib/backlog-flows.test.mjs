import assert from 'node:assert/strict';
import test from 'node:test';
import { authReturnPath } from '../../apps/client/src/lib/admin-navigation.ts';
import { selectMyMatchup } from '../../apps/client/src/lib/matchup-selection.ts';

test('join handoff preserves only canonical invitation paths', () => {
  assert.equal(authReturnPath('/leagues/join?code=ab12cd34'), '/leagues/join?code=AB12CD34');
  for (const path of [
    'https://attacker.test/leagues/join?code=AB12CD34',
    '//attacker.test',
    '/leagues/join?code=AB12CD34&next=https://attacker.test',
    '/leagues/join?code=%0d%0aLocation:evil',
    '/leagues/join?code=short',
  ])
    assert.equal(authReturnPath(path), '/dashboard');
});
test('matchup selection ignores other teams and follows active, next, latest final order', () => {
  const rows = [
    { id: 'other', homeTeamId: 'other', awayTeamId: 'stranger', status: 'active', period: 1 },
    { id: 'late', homeTeamId: 'mine', awayTeamId: 'other', status: 'scheduled', period: 5 },
    { id: 'next', homeTeamId: 'other', awayTeamId: 'mine', status: 'scheduled', period: 3 },
    { id: 'previous', homeTeamId: 'mine', awayTeamId: 'other', status: 'final', period: 2 },
  ];
  assert.equal(selectMyMatchup(rows, 'mine').id, 'next');
  assert.equal(
    selectMyMatchup(
      [
        ...rows,
        { id: 'active', homeTeamId: 'mine', awayTeamId: 'other', status: 'active', period: 2 },
      ],
      'mine',
    ).id,
    'active',
  );
  assert.equal(
    selectMyMatchup(
      rows.filter((row) => row.status === 'final'),
      'mine',
    ).id,
    'previous',
  );
  assert.equal(selectMyMatchup(rows, 'missing'), undefined);
});

test('matchup selection recognizes an underway period while publication is still scheduled', () => {
  const now = Date.now();
  const row = {
    id: 'underway',
    homeTeamId: 'mine',
    awayTeamId: 'other',
    status: 'scheduled',
    period: 2,
    startsAt: new Date(now - 1000).toISOString(),
    endsAt: new Date(now + 60000).toISOString(),
  };
  assert.equal(
    selectMyMatchup(
      [row, { ...row, id: 'future', period: 3, startsAt: new Date(now + 60000).toISOString() }],
      'mine',
    ).id,
    'underway',
  );
  assert.equal(selectMyMatchup([row], null), undefined);
});
