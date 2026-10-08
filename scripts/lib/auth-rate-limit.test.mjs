import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthRateLimiter } from '../../apps/client/src/server/auth-rate-limit.ts';

const env = {
  VERCEL: '1',
  EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_SUPABASE_URL: 'https://fdovowiihxowzatewxgv.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_private_fixture',
  AUTH_RATE_LIMIT_HMAC_SECRET: 'fixture-random-secret-32-bytes-or-more',
};
const request = (headers = {}, origin = 'https://brockfantasy.ca') =>
  new Request(`${origin}/api/auth/sign-in`, {
    headers: { 'x-vercel-forwarded-for': '198.51.100.23', ...headers },
  });

test('independent server instances share a counter without transmitting IPs or emails to the database', async () => {
  const counts = new Map();
  const keys = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://fdovowiihxowzatewxgv.supabase.co/rest/v1/rpc/consume_rate_limit');
    assert.equal(init.headers.apikey, env.SUPABASE_SECRET_KEY);
    assert.equal(init.headers.authorization, undefined, 'new secret key is not a JWT');
    assert.equal(init.redirect, 'error');
    assert.ok(!init.body.includes('198.51.100.23'));
    const body = JSON.parse(init.body);
    assert.match(body.p_key, /^[a-f0-9]{64}$/u);
    keys.push(body.p_key);
    const count = (counts.get(body.p_key) ?? 0) + 1;
    counts.set(body.p_key, count);
    return new Response(JSON.stringify(count <= body.p_limit));
  };
  const live = createAuthRateLimiter({ env: () => env, fetchImpl });
  const staging = createAuthRateLimiter({
    env: () => ({ ...env, EXPO_PUBLIC_APP_ENV: 'staging' }),
    fetchImpl,
  });
  const outcomes = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      (index % 2 ? live : staging)(
        request({}, index % 2 ? 'https://brockfantasy.ca' : 'https://beta.brockfantasy.ca'),
        'sign-in',
      ),
    ),
  );
  assert.equal(outcomes.filter((row) => row.status === 'allowed').length, 8);
  assert.equal(outcomes.filter((row) => row.status === 'limited').length, 4);
  assert.equal(new Set(keys).size, 1);
});

test('Vercel ingress identity takes precedence over spoofed forwarded headers and normalizes IPv6', async () => {
  const keys = [];
  const limit = createAuthRateLimiter({
    env: () => env,
    fetchImpl: async (_url, init) => {
      keys.push(JSON.parse(init.body).p_key);
      return new Response('true');
    },
  });
  await limit(request({ 'x-forwarded-for': '203.0.113.99' }), 'sign-in');
  await limit(request({ 'x-forwarded-for': '203.0.113.100' }), 'sign-in');
  assert.equal(keys[0], keys[1]);
  await limit(request({ 'x-vercel-forwarded-for': '2001:db8:0:0::1' }), 'sign-in');
  await limit(request({ 'x-vercel-forwarded-for': '2001:DB8::1' }), 'sign-in');
  assert.equal(keys[2], keys[3]);
});

test('hosted configuration and untrusted/malformed ingress fail closed without provider calls', async () => {
  const fetchImpl = () => {
    throw new Error('Provider must not be called.');
  };
  for (const changed of [
    { VERCEL: '' },
    { EXPO_PUBLIC_APP_ENV: 'local' },
    { AUTH_RATE_LIMIT_HMAC_SECRET: '' },
    { SUPABASE_SECRET_KEY: '' },
    { EXPO_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
  ]) {
    const limit = createAuthRateLimiter({ env: () => ({ ...env, ...changed }), fetchImpl });
    assert.equal((await limit(request(), 'sign-in')).status, 'unavailable');
  }
  const limit = createAuthRateLimiter({ env: () => env, fetchImpl });
  for (const address of ['', 'not-an-ip', '198.51.100.23, 203.0.113.99']) {
    assert.equal(
      (await limit(request({ 'x-vercel-forwarded-for': address }), 'sign-in')).status,
      'unavailable',
    );
  }
});

test('store outage, timeout, permission failure and malformed response fail closed', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('private provider diagnostic');
    },
    async () => new Response('provider unavailable', { status: 503 }),
    async () => new Response('permission denied', { status: 403 }),
    async () => new Response('{"allowed":true}'),
  ]) {
    const result = await createAuthRateLimiter({ env: () => env, fetchImpl })(request(), 'recover');
    assert.deepEqual(result, { status: 'unavailable', retryAfterSeconds: 30 });
  }
});

test('policy separates auth actions and honors a database denial and retry interval', async () => {
  const bodies = [];
  const limit = createAuthRateLimiter({
    env: () => env,
    now: () => 61_000,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response('false');
    },
  });
  assert.deepEqual(await limit(request(), 'sign-in'), { status: 'limited', retryAfterSeconds: 59 });
  assert.equal((await limit(request(), 'recover')).status, 'limited');
  assert.equal(bodies[0].p_limit, 8);
  assert.equal(bodies[1].p_limit, 5);
  assert.notEqual(bodies[0].p_key, bodies[1].p_key);
});

test('local-only fixed windows expire and ignore caller-supplied forwarded identities', async () => {
  let clock = 61_000;
  const limit = createAuthRateLimiter({
    env: () => ({ EXPO_PUBLIC_APP_ENV: 'local' }),
    now: () => clock,
  });
  for (let index = 0; index < 5; index++)
    assert.equal(
      (await limit(request({ 'x-forwarded-for': `192.0.2.${index}` }), 'sign-up')).status,
      'allowed',
    );
  assert.equal((await limit(request(), 'sign-up')).status, 'limited');
  clock = 120_000;
  assert.equal((await limit(request(), 'sign-up')).status, 'allowed');
});

test('legacy service-role JWT support rejects ordinary user/public keys', async () => {
  const token = `fixture.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  const limit = createAuthRateLimiter({
    env: () => ({ ...env, SUPABASE_SECRET_KEY: token }),
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, `Bearer ${token}`);
      return new Response('true');
    },
  });
  assert.equal((await limit(request(), 'sign-in')).status, 'allowed');
  const denied = createAuthRateLimiter({
    env: () => ({ ...env, SUPABASE_SECRET_KEY: 'sb_publishable_public' }),
    fetchImpl: () => {
      throw new Error('must not call');
    },
  });
  assert.equal((await denied(request(), 'sign-in')).status, 'unavailable');
});

test('Vercel Preview beta works and diagnostics distinguish failures without private data', async () => {
  const diagnostics = [];
  const preview = { ...env, VERCEL_ENV: 'preview', EXPO_PUBLIC_APP_ENV: 'staging' };
  const limit = createAuthRateLimiter({
    env: () => preview,
    onUnavailable: (entry) => diagnostics.push(entry),
    fetchImpl: async () => new Response('true'),
  });
  assert.equal(
    (await limit(request({}, 'https://beta.brockfantasy.ca'), 'sign-in')).status,
    'allowed',
  );
  assert.equal(diagnostics.length, 0);
  for (const [change, reason] of [
    [{ VERCEL: '' }, 'vercel_runtime_missing'],
    [{ EXPO_PUBLIC_APP_ENV: 'local' }, 'app_environment_invalid'],
    [{ EXPO_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }, 'supabase_project_mismatch'],
    [{ AUTH_RATE_LIMIT_HMAC_SECRET: 'short' }, 'hmac_secret_missing_or_short'],
    [{ SUPABASE_SECRET_KEY: '' }, 'server_credential_missing'],
    [{ SUPABASE_SECRET_KEY: 'sb_publishable_wrong_key' }, 'server_credential_invalid'],
  ]) {
    await createAuthRateLimiter({
      env: () => ({ ...preview, ...change }),
      onUnavailable: (entry) => diagnostics.push(entry),
    })(request(), 'sign-in');
    assert.equal(diagnostics.at(-1).reason, reason);
  }
  for (const [fetchImpl, reason, httpStatus] of [
    [async () => new Response('private provider body', { status: 403 }), 'rpc_http_error', 403],
    [
      async () => {
        throw new Error('private provider error');
      },
      'rpc_network_or_timeout',
      undefined,
    ],
    [async () => new Response('{invalid private body'), 'rpc_invalid_response', undefined],
  ]) {
    await createAuthRateLimiter({
      env: () => preview,
      fetchImpl,
      onUnavailable: (entry) => diagnostics.push(entry),
    })(request(), 'sign-in');
    assert.equal(diagnostics.at(-1).reason, reason);
    assert.equal(diagnostics.at(-1).httpStatus, httpStatus);
  }
  const logged = JSON.stringify(diagnostics);
  for (const forbidden of [
    env.SUPABASE_SECRET_KEY,
    env.AUTH_RATE_LIMIT_HMAC_SECRET,
    '198.51.100.23',
    'private provider',
    'sb_publishable_wrong_key',
  ])
    assert.ok(!logged.includes(forbidden));
});
