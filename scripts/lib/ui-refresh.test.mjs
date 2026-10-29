import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingLineupChanges } from '../../apps/client/src/lib/lineup-recovery.ts';
import { pairRankingRows } from '../../apps/client/src/lib/admin-rankings.ts';
import { resolvePublicDeploymentConfig } from '../../config/public-deployment.cjs';

test('pending lineup changes describe final assignments and cancel reversed swaps', () => {
  const baseline = [
    { athlete_id: 'a', slot_code: 'HK_F', status: 'starter' },
    { athlete_id: 'b', slot_code: 'BN', status: 'bench' },
    { athlete_id: 'c', slot_code: 'BN', status: 'bench' },
  ];
  assert.equal(pendingLineupChanges(baseline, { a: 'BN', b: 'HK_F', c: 'BN' }).length, 2);
  assert.deepEqual(pendingLineupChanges(baseline, { a: 'HK_F', b: 'BN', c: 'BN' }), []);
  assert.deepEqual(
    pendingLineupChanges(baseline, { a: 'BN', b: 'BN', c: 'HK_F' }).map(
      (row) => row.entry.athlete_id,
    ),
    ['a', 'c'],
  );
  assert.equal(baseline[0].slot_code, 'HK_F');
});

test('paired rankings preserve competition ties, rank gaps and unequal divisions', () => {
  const row = (id, division, points) => ({
    athlete_id: id,
    name: id,
    position_group: 'HK_F',
    projected_points: points,
    position_rank: null,
    display_data: { division },
  });
  const paired = pairRankingRows([
    row('a', 'womens', 100),
    row('b', 'womens', 100),
    row('c', 'womens', 80),
    row('d', 'mens', 90),
    row('e', 'mens', null),
  ]).get('HK_F');
  assert.deepEqual(
    paired.map((pair) => pair.rank),
    [1, 3, null],
  );
  assert.equal(paired[0].women.length, 2);
  assert.equal(paired[0].men[0].athlete_id, 'd');
  assert.equal(paired[1].men.length, 0);
});

test('preview deployments reject live defaults and require isolated explicit origins', () => {
  const preview = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: 'feat/ui-policy-refresh',
  };
  assert.throws(() => resolvePublicDeploymentConfig(preview), /isolated/u);
  const isolated = {
    ...preview,
    BROCK_PREVIEW_ISOLATED: 'true',
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_APP_ORIGIN: 'https://app-review.example.test',
    PUBLIC_REGISTRATION_ORIGIN: 'https://site-review.example.test',
    EXPO_PUBLIC_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  };
  assert.equal(
    resolvePublicDeploymentConfig(isolated).EXPO_PUBLIC_APP_ORIGIN,
    isolated.EXPO_PUBLIC_APP_ORIGIN,
  );
  assert.throws(
    () =>
      resolvePublicDeploymentConfig({
        ...isolated,
        EXPO_PUBLIC_SUPABASE_URL: 'https://fdovowiihxowzatewxgv.supabase.co',
      }),
    /isolated/u,
  );
  assert.throws(
    () =>
      resolvePublicDeploymentConfig({
        ...isolated,
        PUBLIC_REGISTRATION_ORIGIN: 'https://www.brockfantasy.ca',
      }),
    /isolated/u,
  );
});
