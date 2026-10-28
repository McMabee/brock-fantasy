import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Exercise exported screens with synthetic data and reject any participation command
const root = path.resolve('apps/client/dist/client');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://local');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    const type = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.ttf': 'font/ttf',
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
const output = 'test-results/admin-leagues';
await mkdir(output, { recursive: true });
const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const userId = id(900);
const created = '2026-10-20T12:00:00+00:00';
const leagueRows = Array.from({ length: 27 }, (_, n) => ({
  id: id(n + 1),
  name: `Fixture League ${n + 1}`,
  status: 'active',
  created_at: created,
  commissioner: 'Admin Owner',
  max_members: 4,
  member_count: 2,
  season_label: '2026-27',
})).reverse();
const teams = [
  { id: id(101), name: 'Admin Badgers', owner_id: userId, owner_name: 'Admin Owner' },
  { id: id(102), name: 'Member Team', owner_id: id(901), owner_name: 'Fixture Member' },
];
const allowed = new Set([
  'admin_get_operations_summary',
  'admin_get_league_summary',
  'admin_list_leagues_filtered',
  'admin_get_league_section',
  'admin_get_league_roster',
  'admin_get_league_chat',
  'get_notification_snapshot',
]);
const errors = [];
const writes = [];

try {
  for (const [name, viewport, theme] of [
    ['desktop', { width: 1440, height: 1000 }, 'dark'],
    ['phone', { width: 390, height: 844 }, 'light'],
  ]) {
    const context = await browser.newContext({
      viewport,
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    let denied = false;
    let signedIn = true;
    let aal = 'aal2';
    let unavailable = false;
    let slowRoster = false;
    let deferRoster;
    let chatRequests = 0;
    const messages = Array.from({ length: 121 }, (_, n) => ({
      id: id(200 + n),
      author_id: id(901),
      author: 'Fixture Member',
      body: `Retained message ${n + 1}`,
      created_at: created,
      hidden_at: n === 120 ? created : null,
    }));
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const reply = (body, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: signedIn
            ? { id: userId, email: 'admin@example.test', emailConfirmedAt: created }
            : null,
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/admin/status')
        return reply({ isAdmin: aal === 'aal2', hasAdminRole: true, authenticated: signedIn, aal });
      if (url.pathname === '/api/admin/mfa')
        return reply({
          aal,
          hasAdminRole: true,
          factor: { id: id(990), verified: true },
          enrollmentPending: false,
        });
      if (url.pathname === '/api/auth/refresh')
        return reply({
          user: { id: userId, email: 'admin@example.test' },
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/data/supabase') {
        const target = new URL(url.searchParams.get('path'), 'http://fixture');
        const rpc = target.pathname.split('/').at(-1);
        if (!target.pathname.includes('/rpc/')) return reply([]);
        if (!allowed.has(rpc)) {
          writes.push(rpc);
          return reply({ message: 'Unexpected command', code: '42501' }, 403);
        }
        if (rpc === 'get_notification_snapshot')
          return reply({ notifications: [], unreadCount: 0 });
        if (rpc === 'admin_get_operations_summary')
          return reply({ unresolvedErrors: 0, syncRows: [], auditEvents: [], latestSync: null });
        if (denied) return reply({ message: 'Administrator MFA required', code: '42501' }, 403);
        if (unavailable) return reply({ message: 'Temporary failure', code: 'XX000' }, 500);
        const args = route.request().postDataJSON();
        if (rpc === 'admin_get_league_summary')
          return reply({
            currentSeasonId: id(700),
            currentSeasonLabel: '2026-27',
            openCount: 27,
            seasons: ['2026-27', '2025-26'],
          });
        if (rpc === 'admin_list_leagues_filtered') {
          const previousLeague = {
            ...leagueRows[0],
            name: 'Previous League',
            status: 'complete',
            season_label: '2025-26',
          };
          let rows = [...leagueRows, previousLeague].filter(
            (row) =>
              (!args.p_seasons.length ||
                args.p_seasons.includes(row.season_label) ||
                (args.p_seasons.includes('current') && row.season_label === '2026-27') ||
                (args.p_seasons.includes('previous') && row.season_label === '2025-26')) &&
              (!args.p_statuses.length ||
                args.p_statuses.includes(row.status) ||
                (args.p_statuses.includes('open') &&
                  ['setup', 'drafting', 'active'].includes(row.status))),
          );
          if (args.p_query)
            rows = rows.filter((row) =>
              args.p_query === 'member@example.test'
                ? row.id === leagueRows[0].id && row.season_label === '2026-27'
                : row.name.toLowerCase().includes(args.p_query.toLowerCase()),
            );
          const filteredCount = rows.length;
          if (args.p_before_id) rows = rows.filter((row) => row.id < args.p_before_id);
          return reply({
            items: rows.slice(0, 25),
            filteredCount,
            totalCount: 28,
            hasMore: rows.length > 25,
            nextCursor: rows.length
              ? { at: created, id: rows[Math.min(24, rows.length - 1)].id }
              : null,
          });
        }
        if (rpc === 'admin_get_league_section') {
          const league = {
            ...leagueRows.find((row) => row.id === args.p_league_id),
            format: 'head_to_head',
            roster_format: 'standard',
            ruleset_name: 'Fixture rules',
            ruleset_version: 1,
            draft_status: 'complete',
            draft_mode: 'live',
            draft_scheduled_for: created,
            draft_pick_seconds: 120,
            free_agents_enabled: true,
            waivers_enabled: true,
            trades_enabled: true,
          };
          const sections = {
            members: [
              {
                user_id: id(901),
                display_name: 'Fixture Member',
                email: 'member@example.test',
                account_status: 'Active',
                role: 'member',
                joined_at: created,
                is_varsity: true,
                team_name: 'Member Team',
              },
            ],
            standings: [
              {
                fantasy_team_id: teams[0].id,
                rank: 1,
                wins: 2,
                losses: 0,
                ties: 0,
                points_for: 180,
                points_against: 120,
                standing_points: 4,
              },
            ],
            matchups: [
              {
                id: id(600),
                period: 1,
                home_team_id: teams[0].id,
                away_team_id: teams[1].id,
                home_points: 90,
                away_points: 60,
                status: 'final',
                starts_at: created,
                ends_at: created,
                stage: 'regular',
              },
            ],
          };
          return reply({
            league,
            teams,
            section: args.p_section,
            items: sections[args.p_section] ?? [],
          });
        }
        if (rpc === 'admin_get_league_roster') {
          if (slowRoster && args.p_team_id === teams[0].id)
            await new Promise((resolve) => {
              deferRoster = resolve;
            });
          return reply(
            args.p_team_id === teams[1].id
              ? []
              : [
                  {
                    id: id(801),
                    athlete_id: id(802),
                    display_name: 'Saved Athlete',
                    slot_code: 'HK_F',
                    position: 'F',
                    status: 'starter',
                    jersey_number: '19',
                    program_name: 'Men’s hockey',
                  },
                ],
          );
        }
        if (rpc === 'admin_get_league_chat') {
          chatRequests++;
          const rows = messages
            .filter((row) => !args.p_before_id || row.id < args.p_before_id)
            .slice()
            .reverse();
          return reply({
            items: rows.slice(0, 50).reverse(),
            hasMore: rows.length > 50,
            nextCursor: rows.length
              ? { at: created, id: rows[Math.min(49, rows.length - 1)].id }
              : null,
          });
        }
      }
      return reply({});
    });
    const page = await context.newPage();
    const visibleText = (text, options) => page.getByText(text, options).filter({ visible: true });
    await page.clock.install();
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    await page.goto(origin + '/admin');
    await page.getByRole('button', { name: 'Necessary only', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-brock-theme', theme);
    await expect(
      page.getByRole('link', { name: 'Leagues registered, view league directory' }),
    ).toContainText('27');
    await page.getByRole('link', { name: 'Leagues registered, view league directory' }).click();
    await expect(page.getByRole('link', { name: /^View Fixture League/u })).toHaveCount(25);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(visibleText('Page 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^View Fixture League/u })).toHaveCount(2);
    await page.getByRole('link', { name: 'View Fixture League 2', exact: true }).click();
    await expect(visibleText('ADMIN VIEW · READ ONLY')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'League section: Members and teams', exact: true })
      .click();
    await expect(visibleText('member@example.test', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'League section: Rosters', exact: true }).click();
    await expect(visibleText('Saved Athlete #19', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set lineup' })).toHaveCount(0);
    await expect(visibleText('Free agents, waivers & trades', { exact: true })).toHaveCount(0);
    await visibleText('Saved Athlete #19', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${name}-roster.png`, fullPage: true });
    await page.getByRole('button', { name: 'Team roster: Member Team', exact: true }).click();
    await expect(visibleText('Roster is empty', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'League section: Standings', exact: true }).click();
    await expect(page.getByRole('table', { name: 'League standings', exact: true })).toContainText(
      '180',
    );
    await page.getByRole('button', { name: 'League section: Matchups', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Period 1 matchups', exact: true })).toContainText(
      '90 – 60',
    );
    await page.getByRole('button', { name: 'League section: Chat', exact: true }).click();
    await expect(visibleText('Hidden by moderation', { exact: true })).toBeVisible();
    await expect(visibleText(/^Retained message \d+$/u)).toHaveCount(50);
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
    await expect(visibleText(/^Retained message \d+$/u)).toHaveCount(100);
    await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
    await expect(visibleText(/^Retained message \d+$/u)).toHaveCount(121);
    const beforePoll = chatRequests;
    await page.clock.fastForward(30_001);
    await expect.poll(() => chatRequests).toBeGreaterThan(beforePoll);
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.evaluate(() => {
      globalThis.document.hasFocus = () => false;
      globalThis.window.dispatchEvent(new Event('blur'));
    });
    const beforeBackground = chatRequests;
    await page.clock.fastForward(60_001);
    assert.equal(chatRequests, beforeBackground, 'background views stop polling');
    await page.evaluate(() => {
      globalThis.document.hasFocus = () => true;
      globalThis.window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => chatRequests).toBeGreaterThan(beforeBackground);
    messages.push(
      ...Array.from({ length: 61 }, (_, n) => ({
        id: id(400 + n),
        author_id: null,
        author: 'Unavailable account',
        body: `New message ${n + 1}`,
        created_at: created,
        hidden_at: null,
      })),
    );
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(visibleText(/^New message \d+$/u)).toHaveCount(61);
    await expect(visibleText(/^Retained message \d+$/u)).toHaveCount(121);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /send|mute|report|hide message/iu })).toHaveCount(
      0,
    );
    await page.screenshot({ path: `${output}/${name}-chat.png`, fullPage: true });
    const audit = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      audit.violations
        .filter((violation) => ['critical', 'serious'].includes(violation.impact))
        .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      [],
    );
    await page.getByRole('link', { name: 'Back to league directory', exact: true }).click();
    await expect(visibleText('Page 2', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Season: Current', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Season: Previous', exact: true }).click();
    await expect(visibleText('No leagues found', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Status: Completed', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'View Previous League', exact: true }),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'Season: Previous', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Season: Current', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Status: Completed', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Find a league, team, or member' })
      .fill('member@example.test');
    await page.getByRole('button', { name: 'Search leagues', exact: true }).click();
    await expect(page.getByRole('link', { name: /^View Fixture League/u })).toHaveCount(1);
    await page.screenshot({ path: `${output}/${name}-directory.png`, fullPage: true });
    const directoryUrl = page.url();
    await page.getByRole('link', { name: /^View Fixture League/u }).click();
    await page.getByRole('link', { name: 'Back to league directory', exact: true }).click();
    await expect(page).toHaveURL(directoryUrl);
    await page.getByRole('link', { name: /^View Fixture League/u }).click();
    unavailable = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      visibleText('Unable to load this view. Please retry.', { exact: true }),
    ).toBeVisible();
    unavailable = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      visibleText('Unable to load this view. Please retry.', { exact: true }),
    ).toHaveCount(0);
    slowRoster = true;
    await page.getByRole('button', { name: 'League section: Rosters', exact: true }).click();
    await expect.poll(() => Boolean(deferRoster)).toBe(true);
    await page.getByRole('button', { name: 'Team roster: Member Team', exact: true }).click();
    await expect(visibleText('Roster is empty', { exact: true })).toBeVisible();
    deferRoster();
    slowRoster = false;
    await expect(visibleText('Saved Athlete #19', { exact: true })).toHaveCount(0);
    denied = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      visibleText('Administrator access is no longer available. Sign in and verify MFA again.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(visibleText('Member Team', { exact: true })).toHaveCount(0);
    assert.ok(chatRequests >= 6);
    denied = false;
    signedIn = false;
    const nextPath = `/admin/leagues/${id(2)}?season=previous&status=archived&q=Fixture&tab=members`;
    await page.goto(origin + nextPath);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/auth');
    assert.equal(new URL(page.url()).searchParams.get('next'), nextPath);
    signedIn = true;
    aal = 'aal1';
    await page.goto(origin + nextPath);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/mfa');
    assert.equal(new URL(page.url()).searchParams.get('next'), nextPath);
    aal = 'aal2';
    await page.reload();
    await expect(page).toHaveURL(origin + nextPath);
    await expect(visibleText('member@example.test', { exact: true })).toBeVisible();
    await context.close();
    console.log(
      `${name}: tracker, pagination, filters, sections, hidden chat, refresh gaps, stale rosters, access loss, and accessibility passed`,
    );
  }
  assert.deepEqual(writes, [], 'browsing cannot issue participation commands');
  assert.deepEqual(errors, [], 'screens have no runtime errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
