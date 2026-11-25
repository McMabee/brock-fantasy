import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Exercise UI contracts with synthetic accounts while database tests verify authorization and atomicity
const root = path.resolve('apps/client/dist/client');
const output = 'test-results/athlete-availability';
await mkdir(output, { recursive: true });
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
    response.end('Fixture unavailable');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const poolId = 'b0000000-0000-4000-8000-000000000003';
const stamp = new Date().toISOString();
const report = { hosted: false, checks: [], screenshots: [], errors: [], accessibility: [] };
try {
  for (const theme of ['dark', 'light'])
    for (const width of [320, 390, 829, 1064, 1440]) {
      const context = await browser.newContext({
        viewport: {
          width,
          height: width === 829 || width === 1064 ? 1803 : width === 320 ? 640 : 1000,
        },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        { name: 'bf_theme', value: theme, url: origin },
        { name: 'bf_consent', value: 'v1.preferences', url: origin },
        { name: 'bf_csrf', value: 'fixture', url: origin },
      ]);
      const players = ['Alpha Forward', 'Bravo Forward'].map((name, index) => ({
        id: id(index + 10),
        display_name: name,
        position: 'F',
        jersey_number: String(index + 1),
        status: 'active',
        bio: { program: index ? 'mens_hockey' : 'womens_hockey', sourcePosition: 'Forward' },
        summaries: [],
      }));
      const statuses = new Map(
        players.map((p, index) => [
          p.id,
          {
            id: p.id,
            availability_status: index ? 'injured' : 'active',
            availability_revision: 0,
            availability_changed_at: null,
          },
        ]),
      );
      const notifications = [],
        commands = [],
        unexpected = [];
      const receipts = new Map();
      let statusFailure = false,
        conflict = false,
        readRequests = 0,
        isAdmin = true;
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const reply = (body, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/session')
          return reply({
            user: { id: id(1), email: 'admin@example.test', emailConfirmedAt: stamp },
            expiresAt: Date.now() + 3600000,
          });
        if (url.pathname === '/api/admin/status')
          return reply({
            authenticated: true,
            hasAdminRole: isAdmin,
            isAdmin,
            aal: isAdmin ? 'aal2' : 'aal1',
          });
        if (url.pathname === '/api/admin/accounts') return reply({ canManage: false });
        if (url.pathname === '/api/auth/csrf') return reply({});
        if (url.pathname.startsWith('/api/command/')) {
          const name = url.pathname.split('/').at(-1),
            args = route.request().postDataJSON();
          commands.push({ name, args });
          if (name === 'admin_set_athlete_availability') {
            if (receipts.has(args.p_idempotency_key))
              return reply(receipts.get(args.p_idempotency_key));
            const current = statuses.get(args.p_athlete_id);
            if (conflict || current.availability_revision !== args.p_expected_revision) {
              conflict = false;
              return reply(
                {
                  error: 'Athlete status changed; review the latest status and retry',
                  code: 'PT409',
                },
                409,
              );
            }
            current.availability_status = args.p_availability_status;
            current.availability_revision++;
            current.availability_changed_at = stamp;
            const injured = current.availability_status === 'injured';
            const player = players.find((p) => p.id === current.id);
            notifications.push({
              id: id(100 + notifications.length),
              kind: `athlete_${current.availability_status}`,
              title: `${player.display_name} ${injured ? 'is injured' : 'is active again'}`,
              body: injured
                ? `${player.display_name} (F) has been marked Injured. Review Badgers in Fixture League and find a replacement for that position.`
                : `${player.display_name} has returned to Active. Review your lineup.`,
              data: { athlete_id: current.id, league_id: id(2), pool_id: poolId },
              read_at: null,
              created_at: stamp,
            });
            const result = {
              changed: true,
              revision: current.availability_revision,
              notificationCount: 1,
            };
            receipts.set(args.p_idempotency_key, result);
            return reply(result);
          }
          if (name === 'mark_notification_read') return reply({});
          return reply({});
        }
        if (url.pathname === '/api/data/supabase') {
          const data = new URL(url.searchParams.get('path'), 'http://fixture');
          const resource = data.pathname.split('/').at(-1);
          if (resource === 'athletes') {
            if (data.searchParams.get('select')?.includes('availability_status')) {
              readRequests++;
              if (statusFailure) return reply({ message: 'fixture temporarily unavailable' }, 503);
              const requested =
                data.searchParams
                  .get('id')
                  ?.slice(4, -1)
                  .split(',')
                  .map((value) => value.replaceAll('"', '')) ?? [];
              return reply(
                requested.flatMap((key) => (statuses.has(key) ? [statuses.get(key)] : [])),
              );
            }
            const selected = data.searchParams.get('id')?.replace('eq.', '');
            return reply(selected ? players.find((p) => p.id === selected) : players);
          }
          if (resource === 'get_notification_snapshot')
            return reply({ notifications, unreadCount: notifications.length });
          if (resource === 'get_my_participation')
            return reply({
              role: 'none',
              programs: [],
              revision: 1,
              displayName: 'Fixture Administrator',
            });
          if (resource === 'get_pool_adp') return reply({});
          if (resource === 'athlete_seasons')
            return reply([
              {
                competition_id: id(3),
                team_id: id(4),
                positions: ['F'],
                season: { label: '2026-27' },
              },
            ]);
          if (resource === 'get_player_forecast') return reply(null);
          if (resource === 'get_published_preseason_ranking_seasons')
            return reply({ seasons: ['2026-27'] });
          if (resource === 'get_published_preseason_rankings')
            return reply({
              season: '2026-27',
              publication: { version: 1, published_at: stamp },
              rows: players.map((p, index) => ({
                athlete_id: p.id,
                name: p.display_name,
                position_group: 'HK_F',
                projected_points: 100,
                position_rank: 1,
                provenance: {},
                display_data: {
                  division: index ? 'mens' : 'womens',
                  program: p.bio.program,
                  position: 'F',
                  bio: p.bio,
                  stats: {},
                },
              })),
            });
          if (
            [
              'normalized_player_game_stats',
              'fantasy_point_events',
              'athlete_season_summaries',
              'games',
              'get_historical_game_logs',
              'get_player_trade_options',
              'get_player_insights',
            ].includes(resource)
          )
            return reply([]);
          unexpected.push(resource);
          return reply([]);
        }
        return reply({});
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(error.message));
      await page.goto(`${origin}/admin/athletes`);
      await page.evaluate(() => globalThis.document.fonts.ready);
      await page.bringToFront();
      await expect(
        page.getByRole('button', { name: 'Edit Alpha Forward', exact: true }),
      ).toBeVisible();
      const directory = page.getByRole('table', { name: 'Athlete status directory' });
      await expect(directory.getByText('Active', { exact: true })).toBeVisible();
      await expect(directory.getByText('Injured', { exact: true })).toBeVisible();
      assert.ok(readRequests <= 3, `batched reads rather than per-player reads: ${readRequests}`);
      await page.getByRole('textbox', { name: 'Search athletes' }).fill('Bravo');
      await expect(
        page.getByRole('button', { name: 'Edit Alpha Forward', exact: true }),
      ).toHaveCount(0);
      await page.getByRole('textbox', { name: 'Search athletes' }).fill('');
      await page.getByRole('button', { name: 'Edit Alpha Forward', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('New status', { exact: true })).toBeFocused();
      await page.getByLabel('New status', { exact: true }).selectOption('injured');
      await page.getByRole('textbox', { name: 'Private audit reason' }).fill('short');
      await expect(page.getByRole('button', { name: 'Save status', exact: true })).toBeDisabled();
      await page
        .getByRole('textbox', { name: 'Private audit reason' })
        .fill('Private verified injury report');
      const statusInput = page.getByLabel('New status', { exact: true });
      await statusInput.focus();
      const focusClipping = await statusInput.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        const outset =
          Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
        const clipping = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (!['auto', 'scroll', 'hidden'].includes(globalThis.getComputedStyle(parent).overflowX))
            continue;
          const bounds = parent.getBoundingClientRect();
          if (rect.left - outset < bounds.left - 1 || rect.right + outset > bounds.right + 1)
            clipping.push(parent.tagName);
        }
        return clipping;
      });
      assert.deepEqual(focusClipping, [], `${theme}-${width}: status focus ring fits the panel`);
      const auditReason = page.getByRole('textbox', { name: 'Private audit reason' });
      assert.ok(
        (await auditReason.boundingBox()).height >= 112,
        'audit reason has room for multiple lines',
      );
      const editorShot = `${output}/${theme}-${width}-editor.png`;
      const editorAccess = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      report.accessibility.push({
        theme,
        width,
        view: 'editor',
        violations: editorAccess.violations.map((v) => ({ id: v.id, impact: v.impact })),
      });
      assert.deepEqual(editorAccess.violations, [], `${theme}-${width} editor accessibility`);
      await page.screenshot({ path: editorShot, fullPage: true });
      report.screenshots.push(editorShot);
      await page.getByRole('button', { name: 'Save status', exact: true }).click();
      await expect(page.getByText('Status saved. Created 1 league notification.')).toBeVisible();
      assert.equal(
        commands.find((c) => c.name === 'admin_set_athlete_availability').args.p_expected_revision,
        0,
      );
      assert.equal(notifications.length, 1);
      assert.ok(!JSON.stringify(notifications).includes('Private'));
      await page.getByRole('button', { name: 'Edit Alpha Forward', exact: true }).click();
      await page.getByLabel('New status', { exact: true }).selectOption('active');
      await page
        .getByRole('textbox', { name: 'Private audit reason' })
        .fill('Private verified recovery');
      conflict = true;
      await page.getByRole('button', { name: 'Save status', exact: true }).click();
      await expect(page.getByText(/Athlete status changed while you were editing/)).toBeVisible();
      assert.equal(notifications.length, 1);
      await page.getByRole('button', { name: 'Edit Alpha Forward', exact: true }).click();
      await page.getByLabel('New status', { exact: true }).selectOption('active');
      await page
        .getByRole('textbox', { name: 'Private audit reason' })
        .fill('Private verified recovery');
      await page.getByRole('button', { name: 'Save status', exact: true }).click();
      await expect(page.getByText('Status saved. Created 1 league notification.')).toBeVisible();
      statusFailure = true;
      await page.getByRole('button', { name: 'Refresh statuses', exact: true }).click();
      await expect(page.getByText(/Status updates are unavailable/)).toBeVisible();
      statusFailure = false;
      await page.getByRole('button', { name: 'Refresh statuses', exact: true }).click();
      await expect(page.getByText(/Status updates are unavailable/)).toHaveCount(0);
      await page.getByLabel('Status order', { exact: true }).selectOption('injured');
      await expect(page.locator('tbody tr').first()).toContainText('Bravo Forward');
      const access = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      report.accessibility.push({
        theme,
        width,
        violations: access.violations.map((v) => ({ id: v.id, impact: v.impact })),
      });
      assert.deepEqual(access.violations, [], `${theme}-${width} accessibility`);
      const shot = `${output}/${theme}-${width}-admin.png`;
      await page
        .getByRole('heading', { name: 'Athlete status', exact: true })
        .scrollIntoViewIfNeeded();
      await directory.evaluate((table) => {
        for (let parent = table.parentElement; parent; parent = parent.parentElement)
          parent.scrollLeft = 0;
      });
      await page.screenshot({ path: shot, fullPage: true });
      report.screenshots.push(shot);
      await page.goto(`${origin}/players`);
      await page.getByLabel('Player status', { exact: true }).selectOption('injured');
      await expect(page.getByRole('link').filter({ hasText: 'Bravo Forward' })).toBeVisible();
      await expect(page.getByRole('link').filter({ hasText: 'Alpha Forward' })).toHaveCount(0);
      await page.getByLabel('Player status', { exact: true }).selectOption('all');
      await page.getByRole('button', { name: 'Preseason rankings', exact: true }).click();
      await expect(
        page.getByRole('table', { name: 'Hockey Hockey forward preseason rankings' }),
      ).toBeVisible();
      await page.getByLabel('Player status', { exact: true }).selectOption('injured');
      await expect(page.getByRole('table').first()).toContainText('#1');
      await expect(page.getByRole('table').first()).toContainText('Bravo Forward');
      await expect(page.getByRole('table').first()).not.toContainText('Alpha Forward');
      await page.goto(`${origin}/players/${players[0].id}`);
      await expect(page.getByText('Active', { exact: true })).toBeVisible();
      await expect(page.getByText('ACTIVE', { exact: true })).toHaveCount(0);
      if (theme === 'dark' && width === 390) {
        const started = Date.now();
        statuses.get(players[0].id).availability_status = 'injured';
        await expect(page.getByText('Injured', { exact: true })).toBeVisible({ timeout: 15000 });
        assert.ok(Date.now() - started < 15000, 'status refreshes within 15 seconds');
      }
      const playerShot = `${output}/${theme}-${width}-profile.png`;
      await page.screenshot({ path: playerShot, fullPage: true });
      report.screenshots.push(playerShot);
      await page.goto(`${origin}/notifications`);
      await page.getByRole('button', { name: 'Athlete updates', exact: true }).click();
      await expect(page.getByText('Alpha Forward is injured', { exact: true })).toBeVisible();
      await expect(page.getByText('Alpha Forward is active again', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open Alpha Forward is injured' })).toBeVisible();
      isAdmin = false;
      await page.goto(`${origin}/admin/athletes`);
      await expect(page.getByRole('textbox', { name: 'Search athletes' })).toHaveCount(0);
      assert.deepEqual(unexpected, []);
      report.checks.push(
        `${theme}-${width}: admin editor, audit input, conflict, recovery, batched status reads, reconnection, search sorting/filtering, paired ranks, profile, and owner inbox`,
      );
      await context.close();
    }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    `Athlete availability browser checks passed in ${report.checks.length} theme/viewport combinations`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
