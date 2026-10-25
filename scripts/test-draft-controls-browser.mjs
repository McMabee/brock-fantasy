/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import handler from '../api/index.js';

// - Use synthetic fixtures without private roster files or hosted account mutations
const uid = '11111111-1111-4111-8111-111111111111';
const lid = '22222222-2222-4222-8222-222222222222';
const did = '33333333-3333-4333-8333-333333333333';
const tid = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const teams = [
  { id: tid, league_id: lid, owner_id: uid, name: 'Fixture One', draft_position: 1 },
  { id: other, league_id: lid, owner_id: other, name: 'Fixture Two', draft_position: 2 },
];
const root = path.resolve('apps/client/dist/client');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://local');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    const type = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[path.extname(file)];
    if (file.startsWith(root + path.sep) && type) {
      response.setHeader('content-type', type);
      response.end(await readFile(file));
    } else await handler(request, response);
  } catch {
    response.writeHead(500);
    response.end('Fixture preview failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const errors = [];
await mkdir('test-results/draft-controls', { recursive: true });
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'bf_theme', value: theme, url: origin },
      { name: 'bf_consent', value: 'v1.preferences', url: origin },
      { name: 'bf_csrf', value: 'fixture-csrf', url: origin },
    ]);
    let commissioner = true;
    let paused = true;
    let replaced = false;
    let failed = false;
    let connected = true;
    let denied = false;
    let commands = 0;
    let currentDraftReads = 0;
    let draftReads = 0;
    let notificationReads = 0;
    let legacyNotificationReads = 0;
    const keys = [];
    const league = () => ({
      id: lid,
      commissioner_id: commissioner ? uid : other,
      name: 'Reset fixture league',
      pool_id: 'pool',
      ruleset_id: 'rules',
      format: 'head_to_head',
      status: 'drafting',
      max_members: 4,
      invite_code: 'FIXTURE',
      state_version: 1,
      roster_format: 'standard',
    });
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const reply = (body, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: {
            id: uid,
            email: 'fixture@example.test',
            emailConfirmedAt: new Date().toISOString(),
          },
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/admin/status')
        return reply({ isAdmin: false, hasAdminRole: false, authenticated: true, aal: 'aal1' });
      if (url.pathname.startsWith('/api/draft/')) {
        draftReads++;
        if (denied) return reply({ error: 'Draft membership is required.', code: '42501' }, 403);
        if (!connected) return reply({ error: 'Connection interrupted' }, 503);
        return reply({
          revision: `fixture-${paused}-${commissioner}-${replaced}`,
          poolRevision: 'pool-1',
          serverTime: new Date().toISOString(),
          unchanged: false,
          closed: replaced,
          replaced,
          draft: {
            id: did,
            league_id: lid,
            status: paused ? 'paused' : 'active',
            rounds: 10,
            current_overall_pick: 1,
            pick_deadline: paused ? null : new Date(Date.now() + 120000).toISOString(),
            state_version: 1,
            team_order: [tid, other],
          },
          league: league(),
          teams,
          picks: [],
          roster: [],
          queue: [],
          myTeamId: tid,
          slots: [],
          candidates: [],
          players: [],
          legalAthleteIds: [],
        });
      }
      if (url.pathname.endsWith('/set_draft_status')) {
        const payload = route.request().postDataJSON();
        commands++;
        keys.push(payload.p_idempotency_key);
        assert.equal(payload.p_draft_id, did);
        assert.ok(commissioner);
        if (failed) return reply({ error: 'Temporary resume failure' }, 503);
        paused = payload.p_status === 'paused';
        return reply({ status: payload.p_status });
      }
      if (url.pathname === '/api/data/supabase') {
        const query = new URL(url.searchParams.get('path'), origin);
        const table = query.pathname.split('/').at(-1);
        if (table === 'get_notification_snapshot') {
          notificationReads++;
          return reply({ notifications: [], unreadCount: 0 });
        }
        if (table === 'notifications') legacyNotificationReads++;
        if (table === 'leagues') return reply(query.searchParams.has('id') ? league() : [league()]);
        if (table === 'fantasy_teams') return reply(teams);
        if (table === 'get_my_participation')
          return reply({ role: 'none', programs: [], revision: 1, displayName: 'Fixture' });
        if (table === 'drafts') {
          const current = {
            id: did,
            league_id: lid,
            status: paused ? 'paused' : 'active',
            voided_at: null,
          };
          if (query.searchParams.get('voided_at') === 'is.null') {
            currentDraftReads++;
            return reply(query.searchParams.get('select') === 'id,status' ? current : [current]);
          }
          return reply([current, { ...current, id: 'archived-draft', voided_at: '2026-10-20' }]);
        }
        return reply([]);
      }
      return reply({});
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/draft/' + did);
    await page.getByRole('heading', { name: 'Draft paused', exact: true }).waitFor();
    const visibleReads = draftReads;
    await page.waitForTimeout(2300);
    assert.ok(draftReads > visibleReads, 'Visible paused drafts keep the two-second cadence');
    // - Control visibility explicitly because headless Chromium emulates focus for every page
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    const hiddenReads = { draft: draftReads, notification: notificationReads };
    await page.waitForTimeout(5500);
    assert.deepEqual(
      { draft: draftReads, notification: notificationReads },
      hiddenReads,
      'Hidden tabs stop draft and notification polling',
    );
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for (let n = 0; n < 30 && draftReads === hiddenReads.draft; n++) await page.waitForTimeout(100);
    assert.ok(
      draftReads > hiddenReads.draft,
      'Returning to the tab immediately refreshes the draft',
    );
    assert.equal(
      legacyNotificationReads,
      0,
      'Notifications use one snapshot RPC instead of paired table reads',
    );
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      // - Wait for responsive React layouts to settle after the viewport changes
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Draft overflow at ${width}`,
      );
      await page.screenshot({ path: `test-results/draft-controls/paused-${theme}-${width}.png` });
    }
    failed = true;
    await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
    await page.getByText('Temporary resume failure', { exact: true }).waitFor();
    assert.equal(paused, true);
    failed = false;
    await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
    await page.getByRole('button', { name: 'Pause draft', exact: true }).waitFor();
    assert.equal(paused, false);
    assert.equal(keys[0], keys[1]);
    await page.getByRole('button', { name: 'Pause draft', exact: true }).click();
    await page.getByRole('heading', { name: 'Draft paused', exact: true }).waitFor();
    assert.equal(commands, 3);
    connected = false;
    await page
      .getByRole('button', { name: 'Retry connection', exact: true })
      .waitFor({ timeout: 20000 });
    assert.equal(
      await page.getByRole('button', { name: 'Resume draft', exact: true }).isDisabled(),
      true,
    );
    connected = true;
    await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await page.getByRole('button', { name: 'Resume draft', exact: true }).waitFor();
    denied = true;
    await page
      .getByText('Draft membership is required.', { exact: false })
      .waitFor({ timeout: 20000 });
    const deniedReads = draftReads;
    await page.waitForTimeout(4500);
    assert.equal(draftReads, deniedReads, 'Access denial stops automatic reads');
    assert.equal(
      await page.getByRole('heading', { name: 'Draft paused', exact: true }).count(),
      0,
      'Access denial clears the private draft snapshot',
    );
    denied = false;
    await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
    await page.getByRole('button', { name: 'Resume draft', exact: true }).waitFor();
    commissioner = false;
    await page.reload();
    await page.getByText('Waiting for the league commissioner to resume the draft.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Resume draft', exact: true }).count(), 0);
    commissioner = true;
    replaced = true;
    await page.reload();
    await page.waitForURL('**/league/' + lid);
    await page.getByRole('link', { name: 'Open draft room', exact: true }).first().waitFor();
    assert.ok(currentDraftReads > 0);
    assert.equal(
      await page
        .getByText('JSON object requested, multiple (or no) rows returned', { exact: true })
        .count(),
      0,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: reset league lookup, commissioner resume/pause, retries, disconnect, member access, old-link redirect, dark/light and responsive layouts',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
