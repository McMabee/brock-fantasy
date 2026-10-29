import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPublishedSportsRpcs } from './published-sports-rpcs.mjs';

const config = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://fixture.invalid',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
};

test('deployed read RPCs are required to deny anonymous execution', async () => {
  const calls = [];
  const result = await verifyPublishedSportsRpcs(config, async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ code: '42501' }, { status: 401 });
  });
  assert.equal(result.length, 3);
  assert.deepEqual(
    calls.map((call) => JSON.parse(call.body)),
    [{}, { p_season: null }, { p_competition_ids: [] }],
  );
  assert.ok(calls.every((call) => call.method === 'POST' && !call.headers.authorization));
});

test('missing migrations and unintended anonymous reads block a release', async () => {
  await assert.rejects(
    verifyPublishedSportsRpcs(config, async () =>
      Response.json({ code: 'PGRST202' }, { status: 404 }),
    ),
    /20261029153800_published_rankings_and_program_games/u,
  );
  await assert.rejects(
    verifyPublishedSportsRpcs(config, async () => Response.json({ rows: [] })),
    /anonymous access must remain denied/u,
  );
  await assert.rejects(
    verifyPublishedSportsRpcs(config, async () =>
      Response.json({ code: 'invalid_api_key' }, { status: 401 }),
    ),
    /readiness check failed with HTTP 401/u,
  );
});

test('transient failures have bounded retries and never reveal credentials or response bodies', async () => {
  const attempts = new Map();
  await verifyPublishedSportsRpcs(config, async (url) => {
    const count = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, count);
    if (count === 1) throw new Error('private transport details');
    return Response.json({ code: '42501' }, { status: 403 });
  });
  assert.ok([...attempts.values()].every((count) => count === 2));
  let failures = 0;
  await assert.rejects(
    verifyPublishedSportsRpcs(config, async () => {
      failures++;
      return new Response('sb_secret_private-canary', { status: 503 });
    }),
    (error) => {
      assert.doesNotMatch(error.message, /sb_secret_|private-canary|sb_publishable_fixture/u);
      return true;
    },
  );
  assert.equal(failures, 6);
});
