import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import handler from '../api/index.js';
import { adminReturnPath } from '../apps/client/src/lib/admin-navigation.ts';

const names = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_APP_ORIGIN',
];
const previous = new Map(names.map((name) => [name, process.env[name]]));
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fdovowiihxowzatewxgv.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_admin_fixture';
process.env.EXPO_PUBLIC_APP_ORIGIN = 'https://beta.brockfantasy.ca';
const networkFetch = globalThis.fetch;
const server = createServer((request, response) => {
  handler(request, response).catch(() => {
    response.statusCode = 500;
    response.end('Adapter failed.');
  });
});
const results = [];
const userId = '11111111-1111-4111-8111-111111111111';
const factorId = '22222222-2222-4222-8222-222222222222';
const gameId = '33333333-3333-4333-8333-333333333333';
const teamId = '44444444-4444-4444-8444-444444444444';
let role = false;
let entries = [];
let failure = '';
const calls = [];
const jwt = (aal) =>
  `fixture.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.signature`;
// Expo export compiles the server routes with production cookie names.
const accessCookie = '__Host-bf-access';
const game = {
  id: gameId,
  competition_id: 'competition-fixture',
  home_team_id: teamId,
  away_team_id: teamId,
  state_version: 7,
  status: 'scheduled',
  home_score: null,
  away_score: null,
};

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    const method = init.method ?? 'GET';
    assert.ok(
      target.startsWith('https://fdovowiihxowzatewxgv.supabase.co/'),
      'all upstream requests stay on the configured project',
    );
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), 'sb_publishable_admin_fixture');
    assert.ok(headers.get('authorization')?.startsWith('Bearer fixture.'));
    calls.push({ target, method });
    if (failure === 'network') throw new Error('private upstream detail');
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId, factors: entries });
    if (target.includes('/rest/v1/user_roles?'))
      return Response.json(role ? [{ role: 'admin' }] : []);
    if (target.endsWith('/auth/v1/factors') && method === 'POST')
      return Response.json({
        id: factorId,
        totp: {
          qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          secret: 'private-factor-fixture',
        },
      });
    if (target.endsWith(`/auth/v1/factors/${factorId}`) && method === 'DELETE')
      return new Response(null, { status: 204 });
    if (target.endsWith(`/auth/v1/factors/${factorId}/challenge`))
      return Response.json({ id: 'challenge-fixture' });
    if (target.endsWith(`/auth/v1/factors/${factorId}/verify`))
      return Response.json({
        access_token: jwt('aal2'),
        refresh_token: 'private-refresh-fixture',
        expires_in: 3600,
      });
    if (target.includes('/rest/v1/games?')) return Response.json([game]);
    if (target.includes('/rest/v1/normalized_player_game_stats?'))
      return failure === 'stats'
        ? new Response('private stats error', { status: 503 })
        : Response.json([]);
    if (target.includes('/rest/v1/athletes?')) return Response.json([]);
    if (target.includes('/rest/v1/competitions?'))
      return Response.json([{ id: 'competition-fixture', sport: { code: 'hockey' } }]);
    if (target.includes('/rest/v1/teams?'))
      return Response.json([{ id: teamId, name: 'Team fixture' }]);
    throw new Error(`Unexpected upstream request: ${method} ${new URL(target).pathname}`);
  };
  const request = async (
    route,
    { aal = null, method = 'GET', body, origin = 'https://beta.brockfantasy.ca', csrf = true } = {},
  ) => {
    const response = await networkFetch(`${base}${route}`, {
      method,
      headers: {
        host: 'beta.brockfantasy.ca',
        'x-forwarded-proto': 'https',
        origin,
        cookie: `${aal ? `${accessCookie}=${jwt(aal)}; ` : ''}bf_csrf=csrf-fixture`,
        ...(csrf ? { 'x-csrf-token': 'csrf-fixture' } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    return { response, data: await response.json() };
  };

  for (const route of ['/api/admin/games', '/api/admin/accounts', '/api/admin/mfa']) {
    const result = await request(route);
    assert.equal(result.response.status, route.endsWith('/mfa') ? 401 : 403);
  }
  assert.equal(calls.length, 0);
  results.push('Anonymous access denied before upstream calls');

  let result = await request('/api/admin/mfa', { aal: 'aal1' });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.hasAdminRole, false);
  assert.equal(result.data.factor, null);
  assert.ok(calls.every((call) => !(call.target.endsWith('/factors') && call.method === 'GET')));
  result = await request('/api/admin/mfa', {
    aal: 'aal1',
    method: 'POST',
    body: { action: 'enroll' },
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.data.factor.qrCode.startsWith('data:image/svg+xml;'));
  assert.equal(result.data.factor.secret, 'private-factor-fixture');
  results.push('Non-admin staff can start their own MFA enrollment; SVG QR renders as a data URL');

  for (const change of [{ origin: 'https://evil.example' }, { csrf: false }]) {
    const before = calls.length;
    result = await request('/api/admin/mfa', {
      aal: 'aal1',
      method: 'POST',
      body: { action: 'enroll' },
      ...change,
    });
    assert.equal(result.response.status, 403);
    assert.equal(calls.length, before);
  }
  results.push('MFA enrollment enforces canonical origin and CSRF');

  entries = [{ id: factorId, status: 'unverified', factor_type: 'totp' }];
  result = await request('/api/admin/mfa', {
    aal: 'aal1',
    method: 'POST',
    body: { action: 'enroll' },
  });
  assert.equal(result.response.status, 200);
  assert.ok(calls.some((call) => call.method === 'DELETE'));
  entries.push({ id: 'verified-factor', status: 'verified', factor_type: 'totp' });
  result = await request('/api/admin/mfa', { aal: 'aal1' });
  assert.equal(result.data.factor.id, 'verified-factor');
  const before = calls.length;
  result = await request('/api/admin/mfa', {
    aal: 'aal1',
    method: 'POST',
    body: { action: 'enroll' },
  });
  assert.equal(result.response.status, 409);
  assert.ok(
    calls.slice(before).every((call) => call.method !== 'DELETE' && call.method !== 'POST'),
  );
  results.push(
    'Incomplete MFA can be restarted; verified factors are prioritized and never removed',
  );

  result = await request('/api/admin/mfa', {
    aal: 'aal1',
    method: 'POST',
    body: { action: 'verify', factorId, code: '123456' },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.aal, 'aal2');
  assert.ok(
    result.response.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith(`${accessCookie}=`) && cookie.includes('HttpOnly')),
  );
  assert.ok(!JSON.stringify(result.data).includes('private-refresh-fixture'));
  results.push('Successful MFA verification upgrades HttpOnly session cookies');

  result = await request('/api/admin/games', { aal: 'aal2' });
  assert.equal(result.response.status, 403);
  role = true;
  result = await request('/api/admin/games', { aal: 'aal1' });
  assert.equal(result.response.status, 403);
  result = await request(`/api/admin/games?gameId=${gameId}`, { aal: 'aal2' });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.game.home.name, 'Team fixture');
  assert.equal(result.data.game.state_version, 7);
  assert.equal(result.data.sport, 'hockey');
  results.push(
    'Scorekeeping requires admin plus AAL2 and returns current game version and team names',
  );

  failure = 'stats';
  result = await request(`/api/admin/games?gameId=${gameId}`, { aal: 'aal2' });
  assert.equal(result.response.status, 503);
  assert.equal(result.data.stats, undefined);
  failure = 'network';
  result = await request('/api/admin/mfa', { aal: 'aal1' });
  assert.equal(result.response.status, 503);
  assert.ok(!JSON.stringify(result.data).includes('private'));
  results.push(
    'Failed detail reads do not become empty editable stats; MFA outages return safe errors',
  );

  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/admin/../account',
    ['/admin/games'],
  ])
    assert.equal(adminReturnPath(value), '/admin');
  assert.equal(adminReturnPath('/admin/games'), '/admin/games');
  process.env.EXPO_PUBLIC_APP_ORIGIN = 'https://play.brockfantasy.ca';
  failure = '';
  result = await request('/api/admin/mfa', {
    aal: 'aal1',
    method: 'POST',
    origin: 'https://play.brockfantasy.ca',
    body: { action: 'verify', factorId, code: '123456' },
  });
  assert.equal(result.response.status, 200);
  results.push(
    'Admin return paths are allowlisted; the same MFA route works with the configured play origin',
  );

  const evidence = {
    checkedAt: new Date().toISOString(),
    environment:
      'Local HTTP server using the actual Vercel entry and Expo export with mocked Supabase responses',
    actualVercelDeployment: false,
    hostedAccountsChanged: false,
    results,
  };
  await mkdir('dev/docs/evidence', { recursive: true });
  await writeFile(
    'dev/docs/evidence/2026-10-08-admin-local.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
} finally {
  globalThis.fetch = networkFetch;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
