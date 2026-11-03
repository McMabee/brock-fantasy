import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import handler from '../api/index.js';

// - Render exported screens with synthetic API data and a controlled Toronto rollover clock
const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const user = id(1),
  league = id(2),
  home = id(3),
  away = id(4);
const root = path.resolve('apps/client/dist/client');
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(new URL(request.url, 'http://local').pathname),
    );
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
const errors = [];
await mkdir('test-results/matchup-rollover', { recursive: true });
const matchups = [
  {
    period: 1,
    starts_at: '2026-10-24T04:00:00Z',
    ends_at: '2026-11-01T04:00:00Z',
    status: 'active',
  },
  {
    period: 2,
    starts_at: '2026-11-01T04:00:00Z',
    ends_at: '2026-11-14T05:00:00Z',
    status: 'scheduled',
  },
  {
    period: 3,
    starts_at: '2026-11-14T05:00:00Z',
    ends_at: '2026-11-22T05:00:00Z',
    status: 'scheduled',
  },
].map((row) => ({
  ...row,
  id: id(10 + row.period),
  league_id: league,
  home_team_id: home,
  away_team_id: away,
  home_points: 12.5,
  away_points: 8.25,
}));
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      timezoneId: 'America/Toronto',
    });
    await context.addCookies([{ name: 'bf_consent', value: 'v1.preferences', url: origin }]);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin, 'fixture must never query a hosted project');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const reply = (body) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: {
            id: user,
            email: 'fixture@example.test',
            emailConfirmedAt: '2026-10-01T00:00:00Z',
          },
          expiresAt: Date.parse('2028-01-01T00:00:00Z'),
        });
      if (url.pathname === '/api/admin/status')
        return reply({ isAdmin: false, hasAdminRole: false, authenticated: true, aal: 'aal1' });
      if (url.pathname === '/api/data/supabase') {
        const table = new URL(url.searchParams.get('path'), origin).pathname.split('/').at(-1);
        if (table === 'leagues')
          return reply({
            id: league,
            name: 'Rollover fixture',
            commissioner_id: user,
            ruleset_id: 'rules',
            format: 'head_to_head',
            status: 'active',
            max_members: 4,
            roster_format: 'standard',
            state_version: 1,
          });
        if (table === 'fantasy_teams')
          return reply([
            { id: home, league_id: league, owner_id: user, name: 'Home fixture' },
            { id: away, league_id: league, owner_id: id(5), name: 'Away fixture' },
          ]);
        if (table === 'matchups') return reply(matchups);
        if (table === 'drafts') return reply(null);
        if (table === 'get_matchup_detail') return reply({ teams: [] });
        if (table === 'get_notification_snapshot')
          return reply({ notifications: [], unreadCount: 0 });
        if (table === 'get_my_participation')
          return reply({ role: 'none', programs: [], revision: 1, displayName: 'Fixture' });
        return reply([]);
      }
      return reply({});
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-01T03:59:30Z') });
    await page.clock.pauseAt(new Date('2026-11-01T03:59:30Z'));
    await page.goto(`${origin}/league/${league}`);
    await expect(page.getByText('Week 1 Matchup', { exact: true })).toBeVisible();
    await page.clock.runFor(30000);
    await expect(page.getByText('Week 2 Matchup', { exact: true })).toBeVisible();
    await expect(page.getByText('AUDITED', { exact: true })).toHaveCount(0);
    await expect(page.getByText('SCHEDULED, WEEK 2', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `test-results/matchup-rollover/week-2-${width}.png` });
    await page.goto(`${origin}/matchups/${league}`);
    await expect(
      page.getByRole('heading', { name: 'Period 2, scheduled', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Period 1: Home fixture vs Away fixture', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Period 1, active', exact: true }),
    ).toBeVisible();
    await page.goto(`${origin}/matchups/${league}?matchupId=${id(11)}`);
    await expect(
      page.getByRole('heading', { name: 'Period 1, active', exact: true }),
    ).toBeVisible();
    await page.goto(`${origin}/league/${league}`);
    await expect(page.getByText('Week 2 Matchup', { exact: true })).toBeVisible();
    await page.clock.fastForward(
      Date.parse(matchups[2].starts_at) - Date.parse(matchups[1].starts_at),
    );
    await expect(page.getByText('Week 3 Matchup', { exact: true })).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-11-22T05:00:00Z'));
    await page.goto(`${origin}/league/${league}`);
    await expect(page.getByText('Latest matchup', { exact: true })).toBeVisible();
    await page.goto(`${origin}/auth`);
    await expect(page.locator('[name="eligibilityAttested"]')).toHaveCount(0);
    await expect(
      page.getByText(
        'Existing accounts only need this confirmation if eligibility has not been recorded yet.',
        { exact: true },
      ),
    ).toHaveCount(0);
    await page.goto(`${origin}/signup`);
    const eligibility = page.getByRole('checkbox', {
      name: 'I am 18 or turn 18 this calendar year.',
      exact: true,
    });
    await expect(eligibility).toHaveJSProperty('required', true);
    assert.equal(await eligibility.evaluate((input) => input.validity.valueMissing), true);
    await eligibility.check();
    assert.equal(await eligibility.evaluate((input) => input.validity.valid), true);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Desktop and mobile: Week 2 heading advances to Week 3 at the boundary; history and fallbacks work; sign-in has no age checkbox and signup requires it',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
