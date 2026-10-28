import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairRankingRows } from '../../apps/client/src/lib/admin-rankings.ts';
import {
  leagueFilterValues,
  groupLeagueMatchups,
} from '../../apps/client/src/lib/admin-leagues.ts';
import {
  adminPagePath,
  adminReturnPath,
  authReturnPath,
} from '../../apps/client/src/lib/admin-navigation.ts';

const athlete = (id, division, points, position = 'HK_F') => ({
  athlete_id: id,
  name: id,
  position_group: position,
  projected_points: points,
  position_rank: 99,
  display_data: { division },
});
test('paired ranking display preserves division ties, rank gaps and missing projections', () => {
  const rows = [
    athlete('Woman A', 'womens', 100),
    athlete('Woman B', 'womens', 100),
    athlete('Woman C', 'womens', 80),
    athlete('Unranked', 'womens', null),
    athlete('Man A', 'mens', 120),
    athlete('Man B', 'mens', 90),
  ];
  const result = pairRankingRows(rows).get('HK_F');
  assert.deepEqual(
    result.map((row) => row.rank),
    [1, 2, 3, null],
  );
  assert.equal(result[0].women.length, 2);
  assert.equal(result[1].women.length, 0);
  assert.equal(result[2].men.length, 0);
  assert.equal(rows[0].position_rank, 99);
  assert.deepEqual(
    rows.map((row) => row.athlete_id),
    ['Woman A', 'Woman B', 'Woman C', 'Unranked', 'Man A', 'Man B'],
  );
});
test('ranking display keeps fantasy positions independent', () => {
  const result = pairRankingRows([
    athlete('Hockey', 'mens', 10),
    athlete('Basketball', 'womens', 900, 'BB_BC'),
  ]);
  assert.equal(result.size, 2);
  assert.equal(result.get('HK_F')[0].rank, 1);
  assert.equal(result.get('BB_BC')[0].rank, 1);
});
test('league selection distinguishes initial defaults from cleared and legacy all links', () => {
  assert.deepEqual(leagueFilterValues(undefined, 'current'), ['current']);
  assert.deepEqual(leagueFilterValues('all', 'current'), []);
  assert.deepEqual(leagueFilterValues('', 'open'), []);
  assert.deepEqual(leagueFilterValues('setup,complete,setup', 'open'), ['setup', 'complete']);
  const grouped = groupLeagueMatchups([
    { id: 'a', period: 2 },
    { id: 'b', period: 1 },
    { id: 'c', period: 2 },
  ]);
  assert.deepEqual(
    grouped.map(([period, rows]) => [period, rows.map((row) => row.id)]),
    [
      [1, ['b']],
      [2, ['a', 'c']],
    ],
  );
});
test('operations and confirmation return navigation preserves only approved local destinations', () => {
  const route = adminPagePath('/admin/syncs', {
    kind: 'schedule',
    status: 'failed',
    q: 'A & B',
    next: 'https://evil.test',
  });
  assert.equal(adminReturnPath(route), route);
  assert.equal(authReturnPath(route), route);
  assert.equal(new URL(route, 'https://local.test').searchParams.has('next'), false);
  const confirmation = '/participation/confirm/11111111-1111-4111-8111-111111111111';
  assert.equal(authReturnPath(confirmation), confirmation);
  for (const value of [
    `https://evil.test${confirmation}`,
    `${confirmation}?next=https://evil.test`,
    '/participation/confirm/invalid',
    '/admin/syncs/../accounts',
    '//evil.test/admin/syncs',
  ])
    assert.equal(authReturnPath(value), '/dashboard');
});
