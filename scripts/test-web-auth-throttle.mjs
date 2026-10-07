import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(path.join(root, 'apps/client/package.json'));
const { createRequestHandler } = require('expo-server/adapter/vercel');
const handler = createRequestHandler({ build: path.join(root, 'apps/client/dist/server') });
const names = [
  'EXPO_PUBLIC_APP_ENV',
  'EXPO_PUBLIC_APP_ORIGIN',
  'EXPO_PUBLIC_SUPABASE_URL',
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
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    host: 'localhost:8081',
    'content-type': 'application/json',
    origin: 'http://localhost:8081',
    'x-forwarded-proto': 'http',
  };
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
  const evidence = {
    checkedAt: new Date().toISOString(),
    environment: 'local Node HTTP server with actual Expo export and Vercel adapter',
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
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
