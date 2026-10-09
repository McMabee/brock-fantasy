import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/index.js';

const root = process.cwd();
const names = [
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_APP_ORIGIN',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'VERCEL',
  'SUPABASE_SECRET_KEY',
  'AUTH_RATE_LIMIT_HMAC_SECRET',
];
const previous = new Map(names.map((name) => [name, process.env[name]]));
process.env.EXPO_PUBLIC_APP_ENV = 'local';
process.env.EXPO_PUBLIC_APP_ORIGIN = 'http://localhost:8081';
delete process.env.VERCEL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.AUTH_RATE_LIMIT_HMAC_SECRET;
const server = createServer((request, response) => {
  handler(request, response).catch(() => {
    response.statusCode = 500;
    response.end('Local adapter failed.');
  });
});
const results = [];
const networkFetch = globalThis.fetch;
const originalError = console.error;
const diagnostics = [];
console.error = (entry) => diagnostics.push(String(entry));
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    host: 'localhost:8081',
    'content-type': 'application/json',
    origin: 'http://localhost:8081',
    'x-forwarded-proto': 'http',
  };
  for (const route of ['/', '/dashboard']) {
    const page = await fetch(`${url}${route}`, { headers });
    assert.equal(page.status, 200);
    assert.ok(page.headers.get('content-type').includes('text/html'));
  }
  results.push({ scenario: 'root Vercel entry serves home and dashboard HTML', status: 200 });
  const protectedData = await fetch(`${url}/api/data/supabase`, { headers });
  assert.equal(protectedData.status, 401);
  results.push({ scenario: 'anonymous data access remains protected', status: 401 });
  // Invalid credentials are rejected before a provider call, allowing a real
  // exported-route throttle test without sending signup/email/login requests.
  for (let index = 0; index < 9; index++) {
    const response = await fetch(`${url}/api/auth/sign-in`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(response.status, index < 8 ? 400 : 429);
    assert.ok(response.headers.get('cache-control').includes('no-store'));
    if (index === 8) assert.ok(Number(response.headers.get('retry-after')) >= 1);
  }
  results.push({
    scenario: 'local exported route: first eight invalid requests then rate denial',
    allowedToValidation: 8,
    rateLimited: 1,
    retryAfterPresent: true,
  });
  process.env.EXPO_PUBLIC_APP_ENV = 'production';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fdovowiihxowzatewxgv.supabase.co';
  process.env.VERCEL = '1';
  const unavailable = await fetch(`${url}/api/auth/sign-in`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('retry-after'), '30');
  results.push({
    scenario: 'missing hosted counter secrets fail closed',
    status: 503,
    retryAfter: 30,
  });
  const csrf = await fetch(`${url}/api/auth/csrf`);
  const cookie = csrf.headers
    .getSetCookie()
    .find((value) => value.startsWith('bf_csrf='))
    ?.split(';')[0];
  assert.ok(cookie);
  const token = decodeURIComponent(cookie.slice('bf_csrf='.length));
  const logout = await fetch(`${url}/api/auth/sign-out`, {
    method: 'POST',
    headers: { ...headers, cookie, 'x-csrf-token': token },
    body: '{}',
  });
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.getSetCookie().some((value) => value.includes('Max-Age=0')));
  assert.equal((await logout.json()).globalSignoutConfirmed, false);
  results.push({
    scenario: 'CSRF-protected local logout available during missing-store outage',
    status: 200,
    sessionCookiesCleared: true,
    globalSignoutConfirmed: false,
  });
  const wrongOrigin = await fetch(`${url}/api/auth/sign-in`, {
    method: 'POST',
    headers: { ...headers, origin: 'https://invalid.example' },
    body: '{}',
  });
  assert.equal(wrongOrigin.status, 403);
  results.push({ scenario: 'wrong-origin mutation rejected before counter', status: 403 });

  process.env.EXPO_PUBLIC_APP_ENV = 'staging';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_auth_route_fixture';
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_auth_route_fixture';
  process.env.AUTH_RATE_LIMIT_HMAC_SECRET = 'private-auth-route-fixture-32-characters';
  const calls = [];
  let scenario = 'success';
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    assert.ok(target.startsWith('https://fdovowiihxowzatewxgv.supabase.co/'));
    calls.push(target);
    if (target.endsWith('/rpc/consume_rate_limit')) {
      assert.equal(init.headers.apikey, process.env.SUPABASE_SECRET_KEY);
      assert.ok(!init.body.includes('198.51.100.23'));
      if (scenario === 'rpc-error') return new Response('private RPC diagnostic', { status: 403 });
      return new Response(scenario === 'limited' ? 'false' : 'true');
    }
    if (target.endsWith('/rpc/is_approved_tester_email'))
      return Response.json(scenario !== 'unapproved');
    if (target.endsWith('/rpc/can_use_app')) return Response.json(scenario !== 'revoked');
    const requestHeaders = new Headers(init.headers);
    assert.equal(requestHeaders.get('apikey'), process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    assert.equal(init.redirect, 'error');
    if (target.includes('grant_type=password')) {
      assert.deepEqual(JSON.parse(init.body), {
        email: 'fixture@example.invalid',
        password: 'private-password-fixture',
      });
      if (scenario === 'invalid-login')
        return new Response('private provider rejection', { status: 400 });
      if (scenario === 'auth-error')
        return new Response('private provider diagnostic', { status: 503 });
      if (scenario === 'network-error') throw new Error('private network diagnostic');
      if (scenario === 'malformed-tokens') return new Response('{"access_token":null}');
      return Response.json({
        access_token: 'private-access-token-fixture',
        refresh_token: 'private-refresh-token-fixture',
        expires_in: 3600,
      });
    }
    assert.ok(target.endsWith('/auth/v1/user'));
    assert.equal(init.headers.get('authorization'), 'Bearer private-access-token-fixture');
    if (scenario === 'user-error') return new Response('private user diagnostic', { status: 503 });
    return Response.json({
      id: 'fixture-user',
      email: 'fixture@example.invalid',
      email_confirmed_at: '2026-10-08T00:00:00Z',
    });
  };
  for (const [name, expected] of [
    ['success', 200],
    ['unapproved', 401],
    ['revoked', 403],
    ['limited', 429],
    ['rpc-error', 503],
    ['invalid-login', 401],
    ['auth-error', 503],
    ['network-error', 503],
    ['malformed-tokens', 503],
    ['user-error', 503],
    ['missing-public-key', 503],
  ]) {
    scenario = name;
    calls.length = 0;
    if (name === 'missing-public-key') delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const result = await networkFetch(`${url}/api/auth/sign-in`, {
      method: 'POST',
      headers: { ...headers, 'x-vercel-forwarded-for': '198.51.100.23' },
      body: JSON.stringify({
        email: 'fixture@example.invalid',
        password: 'private-password-fixture',
      }),
    });
    assert.equal(result.status, expected, name);
    const payload = await result.json();
    if (name === 'success') {
      assert.equal(payload.user.id, 'fixture-user');
      assert.equal(
        calls.length,
        5,
        'counter, approval lookup, password grant, user lookup, current entitlement',
      );
      assert.ok(result.headers.getSetCookie().some((value) => value.includes('HttpOnly')));
    } else {
      assert.ok(!JSON.stringify(payload).includes('private'));
      if (['limited', 'rpc-error'].includes(name)) assert.equal(calls.length, 1);
      if (expected === 503) assert.equal(result.headers.get('retry-after'), '30');
    }
    results.push({
      scenario: `staging exported sign-in with mocked provider: ${name}`,
      status: expected,
    });
  }
  const logged = diagnostics.join('\n');
  for (const code of [
    'hmac_secret_missing_or_short',
    'rpc_http_error',
    'provider_http_error',
    'provider_network_or_timeout',
    'provider_invalid_response',
    'public_supabase_key_missing',
  ])
    assert.ok(logged.includes(code), code);
  for (const forbidden of [
    'private-password-fixture',
    'private-access-token-fixture',
    'private-refresh-token-fixture',
    process.env.SUPABASE_SECRET_KEY,
    process.env.AUTH_RATE_LIMIT_HMAC_SECRET,
    '198.51.100.23',
    'private provider',
    'private network',
    'private RPC',
  ])
    assert.ok(!logged.includes(forbidden));
  const evidence = {
    checkedAt: new Date().toISOString(),
    environment: 'local Node HTTP server with actual root Vercel entry and Expo server export',
    status: 'verified',
    actualVercelDeployment: false,
    providerAuthRequestsMade: false,
    results,
  };
  await mkdir(path.join(root, 'dev/docs/evidence'), { recursive: true });
  await writeFile(
    path.join(root, 'dev/docs/evidence/2026-10-07-web-auth-throttle.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
} finally {
  globalThis.fetch = networkFetch;
  console.error = originalError;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
