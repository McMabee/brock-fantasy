import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import handler from '../api/index.js';
import { adminReturnPath, authReturnPath } from '../apps/client/src/lib/admin-navigation.ts';

const names = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_APP_ORIGIN',
  'RESEND_API_KEY',
  'ADMIN_INVITE_EMAIL_FROM',
];
const previous = new Map(names.map((name) => [name, process.env[name]]));
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fdovowiihxowzatewxgv.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_admin_fixture';
process.env.EXPO_PUBLIC_APP_ORIGIN = 'https://beta.brockfantasy.ca';
process.env.RESEND_API_KEY = 're_private_admin_invite_fixture';
process.env.ADMIN_INVITE_EMAIL_FROM = 'Brock Fantasy <admin@example.test>';
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
const invitationId = '55555555-5555-4555-8555-555555555555';
let role = false;
let canManage = false;
let invitationSent = false;
const emails = [];
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
    if (target === 'https://api.resend.com/emails') {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('authorization'), 'Bearer re_private_admin_invite_fixture');
      assert.equal(headers.get('idempotency-key'), `brock-admin-invitation/${invitationId}`);
      emails.push(JSON.parse(init.body));
      return failure === 'email'
        ? Response.json({ error: 'private email provider detail' }, { status: 503 })
        : Response.json({ id: 'email-fixture' });
    }
    assert.ok(
      target.startsWith('https://fdovowiihxowzatewxgv.supabase.co/'),
      'all upstream requests stay on the configured project',
    );
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), 'sb_publishable_admin_fixture');
    if (
      target.endsWith('/auth/v1/user') &&
      headers.get('authorization') === 'Bearer invalid-fixture'
    )
      return Response.json({ error: 'Invalid bearer token' }, { status: 401 });
    assert.ok(headers.get('authorization')?.startsWith('Bearer fixture.'));
    calls.push({ target, method });
    if (failure === 'network') throw new Error('private upstream detail');
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId, factors: entries });
    if (target.endsWith('/rest/v1/rpc/can_use_app')) return Response.json(true);
    if (target.includes('/rest/v1/user_roles?'))
      return Response.json(role ? [{ role: 'admin' }] : []);
    if (target.endsWith('/rest/v1/rpc/can_manage_admin_accounts')) return Response.json(canManage);
    if (target.endsWith('/rest/v1/rpc/admin_create_invitation')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_email, 'staff@example.test');
      return Response.json({
        invitationId,
        email: 'staff@example.test',
        expiresAt: '2026-10-15T18:00:00Z',
        alreadySent: invitationSent,
      });
    }
    if (target.endsWith('/rest/v1/rpc/admin_mark_invitation_sent')) {
      if (failure === 'sent-marker') return new Response('private marker error', { status: 503 });
      invitationSent = true;
      return Response.json({ sent: true });
    }
    if (target.endsWith('/rest/v1/rpc/admin_invitation_status'))
      return failure === 'invitation'
        ? Response.json({ message: 'private account detail' }, { status: 403 })
        : Response.json({ invitationId, accepted: false });
    if (target.endsWith('/rest/v1/rpc/admin_accept_invitation')) {
      role = true;
      return Response.json({ enabled: true });
    }
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
    {
      aal = null,
      method = 'GET',
      body,
      origin = 'https://beta.brockfantasy.ca',
      csrf = true,
      bearer,
    } = {},
  ) => {
    const response = await networkFetch(`${base}${route}`, {
      method,
      headers: {
        host: 'beta.brockfantasy.ca',
        'x-forwarded-proto': 'https',
        origin,
        cookie: `${aal ? `${accessCookie}=${jwt(aal)}; ` : ''}bf_csrf=csrf-fixture`,
        ...(csrf ? { 'x-csrf-token': 'csrf-fixture' } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
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
    calls
      .slice(before)
      .every(
        (call) =>
          call.target.endsWith('/rpc/can_use_app') ||
          (call.method !== 'DELETE' && call.method !== 'POST'),
      ),
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

  failure = '';
  const invitationBody = {
    email: 'staff@example.test',
    reason: 'Staff onboarding',
    idempotencyKey: 'admin-invite-test',
  };
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 403);
  assert.equal(emails.length, 0);
  result = await request('/api/admin/accounts', {
    aal: 'aal1',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 403);
  canManage = true;
  for (const change of [{ origin: 'https://evil.example' }, { csrf: false }]) {
    const before = calls.length;
    result = await request('/api/admin/accounts', {
      aal: 'aal2',
      method: 'POST',
      body: invitationBody,
      ...change,
    });
    assert.equal(result.response.status, 403);
    assert.equal(calls.length, before);
  }
  results.push(
    'Invitation sending requires super administrator AAL2 and web Origin/CSRF; standard admins cannot send',
  );

  delete process.env.RESEND_API_KEY;
  const beforeMissingSender = calls.length;
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 503);
  assert.ok(
    calls
      .slice(beforeMissingSender)
      .every((call) => !call.target.endsWith('/admin_create_invitation')),
  );
  process.env.RESEND_API_KEY = 're_private_admin_invite_fixture';
  failure = 'email';
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 503);
  assert.equal(invitationSent, false);
  assert.ok(!JSON.stringify(result.data).includes('private'));
  failure = '';
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.sent, true);
  assert.equal(invitationSent, true);
  assert.deepEqual(emails.at(-1).to, ['staff@example.test']);
  assert.ok(
    emails.at(-1).text.includes(`https://beta.brockfantasy.ca/mfa?invitation=${invitationId}`),
  );
  assert.ok(!emails.at(-1).text.includes('private'));
  const sentCount = emails.length;
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 200);
  assert.equal(emails.length, sentCount);
  results.push(
    'Missing sender and email failures do not activate invitations; successful retry uses provider idempotency and completed requests do not resend',
  );

  result = await request('/api/admin/accounts', {
    method: 'POST',
    body: invitationBody,
    origin: 'null',
    csrf: false,
    bearer: jwt('aal2'),
  });
  assert.equal(result.response.status, 200);
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
    origin: 'null',
    csrf: false,
    bearer: 'invalid-fixture',
  });
  assert.equal(result.response.status, 403);
  results.push(
    'Native invitations validate explicit bearer tokens; an invalid bearer cannot fall back to an authenticated cookie',
  );

  invitationSent = false;
  failure = 'sent-marker';
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 503);
  assert.equal(invitationSent, false);
  failure = '';
  result = await request('/api/admin/accounts', {
    aal: 'aal2',
    method: 'POST',
    body: invitationBody,
  });
  assert.equal(result.response.status, 200);
  assert.equal(invitationSent, true);
  results.push(
    'Database confirmation failure is reported after email send; retry confirms the same invitation',
  );

  result = await request(`/api/admin/invitation?id=${invitationId}`, { aal: 'aal1' });
  assert.equal(result.response.status, 200);
  failure = 'invitation';
  result = await request(`/api/admin/invitation?id=${invitationId}`, { aal: 'aal1' });
  assert.equal(result.response.status, 403);
  assert.ok(!JSON.stringify(result.data).includes('private'));
  failure = '';
  role = false;
  result = await request('/api/command/admin_accept_invitation', {
    aal: 'aal2',
    method: 'POST',
    body: { p_invitation_id: invitationId },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.enabled, true);
  result = await request(`/api/admin/games?gameId=${gameId}`, { aal: 'aal2' });
  assert.equal(result.response.status, 200);
  results.push(
    'Recipient can check an invitation at AAL1; authenticated acceptance uses the protected database command and unlocks standard admin operations',
  );

  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/admin/../account',
    ['/admin/games'],
  ])
    assert.equal(adminReturnPath(value), '/admin');
  assert.equal(adminReturnPath('/admin/games'), '/admin/games');
  assert.equal(
    authReturnPath(`/mfa?invitation=${invitationId}`),
    `/mfa?invitation=${invitationId}`,
  );
  for (const value of [
    'https://evil.example/mfa',
    '/mfa?invitation=invalid',
    `/mfa?invitation=${invitationId}&next=https://evil.example`,
    ['/mfa'],
  ])
    assert.equal(authReturnPath(value), '/admin');
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
