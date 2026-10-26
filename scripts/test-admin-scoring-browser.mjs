import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Keep scoring browser fixtures synthetic and independent of private CSVs and hosted accounts
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

const output = 'test-results/admin-scoring';
await mkdir(output, { recursive: true });
const errors = [];
try {
  for (const theme of ['dark', 'light']) {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        { name: 'bf_theme', value: theme, url: origin },
        { name: 'bf_consent', value: 'v1.preferences', url: origin },
        { name: 'bf_csrf', value: 'fixture-csrf', url: origin },
      ]);
      const athleteId = '11111111-1111-4111-8111-111111111111';
      const goalieId = '22222222-2222-4222-8222-222222222222';
      let saved = null;
      let version = 1;
      let loseResponse = true;
      const requests = [];
      const previews = [];
      const stats = {
        goals: 1,
        assists: 0,
        power_play_goals: 0,
        short_handed_goals: 0,
        penalty_minutes: 0,
      };
      const fixtureGame = () => ({
        id: 'game',
        starts_at: '2026-10-24T22:00:00Z',
        status: saved ? 'final' : 'scheduled',
        home_score: saved ? 2 : 0,
        away_score: saved ? 1 : 0,
        state_version: version,
        stats_complete: Boolean(saved),
        manual_override: Boolean(saved),
        home: { name: 'Brock' },
        away: { name: 'Toronto' },
        program: 'womens_hockey',
        source_url: 'https://gobadgers.ca/official-boxscore',
      });
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const reply = (body, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/session')
          return reply({
            user: { id: athleteId, email: 'fixture@example.test', emailConfirmedAt: '2026-10-01' },
            expiresAt: Date.now() + 3600000,
          });
        if (url.pathname === '/api/admin/status')
          return reply({ isAdmin: true, hasAdminRole: true, authenticated: true, aal: 'aal2' });
        if (url.pathname === '/api/admin/games')
          return url.searchParams.has('gameId')
            ? reply({
                game: fixtureGame(),
                sport: 'hockey',
                stats: saved ? [{ athlete_id: athleteId, stats }] : [],
                athletes: [
                  { id: athleteId, display_name: 'Scoring fixture defender', position: 'D' },
                  { id: goalieId, display_name: 'Scoring fixture goalie', position: 'G' },
                ],
              })
            : reply({ games: [fixtureGame()] });
        if (url.pathname.endsWith('/preview_game_revision')) {
          previews.push(route.request().postDataJSON());
          return reply({
            players: [
              {
                athlete_id: athleteId,
                previous_points: saved ? 20 : 0,
                projected_points: 20,
                point_difference: saved ? 0 : 20,
                missing_stats: [],
              },
            ],
          });
        }
        if (url.pathname.endsWith('/publish_game_revision')) {
          const payload = route.request().postDataJSON();
          requests.push(payload);
          version = 2;
          saved = {
            game_id: 'game',
            state_version: 2,
            replay: { events_inserted: 0, incomplete: false },
            players: [
              { athlete_id: athleteId, fantasy_points: 20, complete: true, missing_stats: [] },
            ],
          };
          if (loseResponse) {
            loseResponse = false;
            return reply({ error: 'Publication confirmation unavailable. Retry safely.' }, 503);
          }
          return reply(saved);
        }
        if (url.pathname === '/api/data/supabase') {
          const query = new URL(url.searchParams.get('path'), origin);
          const table = query.pathname.split('/').at(-1);
          if (table === 'get_notification_snapshot')
            return reply({ notifications: [], unreadCount: 0 });
          if (table === 'get_my_participation')
            return reply({ role: 'none', programs: [], revision: 1, displayName: 'Fixture' });
          if (table === 'athletes')
            return reply({
              id: athleteId,
              display_name: 'Scoring fixture defender',
              position: 'D',
              jersey_number: '1',
              status: 'active',
              bio: {},
            });
          if (table === 'athlete_seasons')
            return reply([{ competition_id: 'competition', team_id: 'team', positions: ['D'] }]);
          if (table === 'normalized_player_game_stats')
            return reply(
              saved
                ? [
                    {
                      game_id: 'game',
                      stats,
                      fantasy_points: 20,
                      complete: true,
                      missing_stats: [],
                      updated_at: '2026-10-25',
                      game: fixtureGame(),
                    },
                  ]
                : [],
            );
          if (table === 'games')
            return reply([{ ...fixtureGame(), home_team_id: 'team', schedule_confirmed: true }]);
          if (table === 'get_player_forecast') return reply(null);
          if (table === 'get_athlete_adp') return reply([]);
          return reply([]);
        }
        return reply({});
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/admin/games');
      await page.getByRole('button', { name: /Brock vs Toronto/ }).click();
      await expect(page.getByText(/Set Status to Final when the game has ended/)).toBeVisible();
      await page
        .getByRole('switch', { name: 'Include Scoring fixture goalie', exact: true })
        .click();
      const shutout = page.getByRole('combobox', {
        name: 'shutout — no goals allowed',
        exact: true,
      });
      await expect(shutout).toBeVisible();
      await expect(page.getByRole('combobox', { name: /game went to shootout/ })).toHaveCount(0);
      await shutout.selectOption('1');
      await expect(shutout).toHaveValue('1');
      await page.getByRole('combobox', { name: 'individual win', exact: true }).selectOption('1');
      await page.getByRole('combobox', { name: 'individual loss', exact: true }).selectOption('0');
      await page
        .getByRole('combobox', { name: 'only goalie used, allowing empty-net time', exact: true })
        .selectOption('1');
      await page.getByRole('textbox', { name: 'goals allowed', exact: true }).fill('0');
      await page.getByRole('textbox', { name: 'saves', exact: true }).fill('25');
      await page.getByRole('button', { name: 'Preview scoring differences', exact: true }).click();
      await expect.poll(() => previews.length).toBe(1);
      assert.deepEqual(previews[0].p_stats, [
        {
          athlete_id: goalieId,
          stats: {
            shutouts: 1,
            wins: 1,
            losses: 0,
            full_game_solo: 1,
            goals_allowed: 0,
            saves: 25,
          },
        },
      ]);
      await page
        .getByRole('switch', { name: 'Include Scoring fixture goalie', exact: true })
        .click();
      await page
        .getByRole('switch', { name: 'Include Scoring fixture defender', exact: true })
        .click();
      for (const key of [
        'goals',
        'assists',
        'power play goals',
        'short handed goals',
        'penalty minutes',
      ])
        await page
          .getByRole('textbox', { name: key, exact: true })
          .fill(key === 'goals' ? '1' : '0');
      await page.getByRole('button', { name: 'Publish scores', exact: true }).click();
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'Preview the current stat lines before publishing.' }),
      ).toBeInViewport();
      assert.equal(requests.length, 0);
      await page.getByRole('button', { name: 'Preview scoring differences', exact: true }).click();
      await page.getByText(/0 . 20/).waitFor();
      const publish = page.getByRole('button', { name: 'Publish scores', exact: true });
      await publish.click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'a reason of at least 8 characters' }),
      ).toBeInViewport();
      assert.equal(requests.length, 0);
      await page
        .getByRole('textbox', { name: 'Reason for revision (at least 8 characters)', exact: true })
        .fill('Verified against the official game box score');
      await page
        .getByRole('textbox', {
          name: 'Official source or manual reference (3-2048 characters)',
          exact: true,
        })
        .fill('https://gobadgers.ca/boxscore?source=' + 'a'.repeat(200));
      await page.getByRole('textbox', { name: 'Home score', exact: true }).fill('2');
      await page.getByRole('textbox', { name: 'Away score', exact: true }).fill('1');
      await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('final');
      await publish.click();
      const dialog = page.getByRole('dialog', { name: 'Confirm score publication', exact: true });
      await expect(dialog).toBeVisible();
      assert.equal(requests.length, 0);
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations));
      await page.screenshot({ path: path.join(output, `confirmation-${theme}-${width}.png`) });
      await page.getByRole('button', { name: 'Cancel publication', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      assert.equal(requests.length, 0);
      await publish.click();
      await page.getByRole('button', { name: 'Confirm publication', exact: true }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Publication confirmation unavailable' }),
      ).toBeInViewport();
      await publish.click();
      await page.getByRole('button', { name: 'Confirm publication', exact: true }).click();
      await expect(
        page.getByRole('alert').filter({
          hasText: 'Scores published. Revision 2 saved. 1 player lines scored; 0 pending.',
        }),
      ).toBeInViewport();
      assert.equal(requests.length, 2);
      assert.deepEqual(
        requests[1],
        requests[0],
        'A lost-response retry uses the exact same command receipt',
      );
      await page
        .getByText('Scoring fixture defender: 20 FP for this game', { exact: true })
        .waitFor();
      await page.screenshot({ path: path.join(output, `published-${theme}-${width}.png`) });
      await page.goto(origin + '/players/' + athleteId);
      await page.getByText('CURRENT POINTS', { exact: true }).waitFor();
      await page.getByText('20.0', { exact: true }).first().waitFor();
      await page.screenshot({ path: path.join(output, `player-${theme}-${width}.png`) });
      await context.close();
      console.log(
        `Scoring ${theme} ${width}px: validation, confirmation, cancellation, retry, saved points and player total passed`,
      );
    }
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
