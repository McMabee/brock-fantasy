/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';
import { buildPublishedManifest as buildManifest } from './lib/published-rosters.mjs';
import { rosterPlan } from './lib/roster-materialization.mjs';
import { buildManifest as buildCurrentManifest } from './import-brock-beta-data.mjs';
import { rosterMetricsPlan } from './lib/roster-metrics.mjs';

// Controlled browser fixtures never sign in, mutate, or query the hosted project.
const roster = rosterPlan(await buildManifest(), '11111111-1111-4111-8111-111111111111');
const heights = JSON.parse(await readFile('data/brock-heights-2026-27.json', 'utf8'));
const portraits = JSON.parse(await readFile('data/brock-headshots-2026-27.json', 'utf8'));
const userId = '11111111-1111-4111-8111-111111111111';
const leagueId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const teamId = '44444444-4444-4444-8444-444444444444';
const otherTeam = '55555555-5555-4555-8555-555555555555';
const metrics = rosterMetricsPlan(
  await buildCurrentManifest(),
  await buildManifest(),
  heights,
  userId,
  JSON.parse(await readFile('dev/docs/evidence/2026-10-14-roster-suppressions.json', 'utf8')),
);
const metricById = new Map(metrics.players.map((item) => [item.id, item]));
const players = roster.players
  .filter((player) => metricById.has(player.id))
  .map((player, index) => ({
    id: player.id,
    competition_id: 'c',
    team_id: 't',
    display_name: player.name,
    position: player.positions[0],
    jersey_number: player.jersey,
    status: 'active',
    bio: {
      ...player.bio,
      height: metricById.get(player.id).height,
      headshot: portraits.headshots.find((h) => h.id === player.id)?.headshot,
    },
    positions: player.positions,
    program: player.program.replaceAll('_', ' '),
    rank: index + 1,
    adp: {
      average: metricById.get(player.id).suppliedAdp,
      base: metricById.get(player.id).suppliedAdp,
      samples: 0,
    },
    summaries: [
      {
        season_label: '2026-27',
        kind: 'supplied_projection',
        fantasy_points: metricById.get(player.id).projectedPoints,
        games_played: metricById.get(player.id).projectedGames,
        supplied_adp: metricById.get(player.id).suppliedAdp,
        stats: {},
      },
      {
        season_label: '2025-26',
        kind: 'historical',
        fantasy_points: metricById.get(player.id).historicalPoints,
        games_played: metricById.get(player.id).historicalGames,
        stats: metricById.get(player.id).historicalStats,
      },
    ],
  }));
const league = {
  id: leagueId,
  competition_id: null,
  pool_id: 'b0000000-0000-4000-8000-000000000003',
  commissioner_id: userId,
  ruleset_id: 'b0000000-0000-4000-8000-000000000004',
  name: 'Badgers Club',
  format: 'head_to_head',
  status: 'drafting',
  max_members: 4,
  invite_code: 'BADGERS',
  state_version: 1,
};
const teams = [
  { id: teamId, league_id: leagueId, owner_id: userId, name: 'Your Badgers', draft_position: 1 },
  { id: otherTeam, league_id: leagueId, owner_id: null, name: 'Campus Crew', draft_position: 2 },
];
const output = path.resolve('dev/tmp/ui-refresh');
await mkdir(output, { recursive: true });
await Promise.all(
  (await readdir(output))
    .filter((file) => file.endsWith('.png'))
    .map((file) => unlink(path.join(output, file))),
);
const staticRoot = path.resolve('apps/client/dist/client');
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://local').pathname;
    const file = path.resolve(staticRoot, '.' + decodeURIComponent(pathname));
    if (
      file.startsWith(staticRoot + path.sep) &&
      /\.(js|css|ttf|woff2|png|jpg|svg|mp3)$/u.test(file)
    ) {
      const body = await readFile(file);
      const types = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.ttf': 'font/ttf',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.mp3': 'audio/mpeg',
      };
      response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
      response.end(body);
      return;
    }
    await handler(request, response);
  } catch {
    response.statusCode = 500;
    response.end('Local preview failed.');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
const accessibility = [];
let lastPage;
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: 'bf_theme', value: theme, url: origin },
      { name: 'bf_csrf', value: 'test-csrf', url: origin },
    ]);
    let scenario = 'populated';
    let complete = false;
    let commissioner = true;
    let connected = true;
    let expired = false;
    let pendingPick = false;
    let queue = [];
    let picks = [];
    const snapshot = () => ({
      revision: 'revision-' + picks.length + '-' + queue.join(','),
      poolRevision: 'pool-1',
      serverTime: new Date().toISOString(),
      unchanged: false,
      closed: complete,
      draft: {
        id: draftId,
        league_id: leagueId,
        status: complete ? 'complete' : 'active',
        rounds: 10,
        current_overall_pick: picks.length + 1,
        pick_deadline: new Date(Date.now() + (expired ? -10000 : 900000)).toISOString(),
        state_version: picks.length + 1,
        team_order: [teamId, otherTeam],
      },
      league: { id: leagueId, name: league.name, pool_id: 'b0000000-0000-4000-8000-000000000003' },
      teams,
      picks,
      roster: picks.map((p) => ({
        fantasy_team_id: p.fantasy_team_id,
        athlete_id: p.athlete_id,
        slot_code: 'FLEX',
        status: 'active',
      })),
      queue,
      myTeamId: teamId,
      slots: teams.map((t) => ({
        teamId: t.id,
        code: 'FLEX',
        label: 'Flex',
        positions: ['F', 'D', 'G', 'FC', 'BC', 'HT', 'S', 'L'],
      })),
      candidates: players.map((p) => ({ id: p.id, positions: p.positions })),
      players,
      legalAthleteIds: players
        .filter((p) => !picks.some((pick) => pick.athlete_id === p.id))
        .map((p) => p.id),
    });
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const reply = (body, status = 200, headers = {}) =>
        route.fulfill({
          status,
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: {
            id: userId,
            email: 'manager@example.test',
            emailConfirmedAt: new Date().toISOString(),
          },
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/admin/status') return reply({ isAdmin: false });
      if (url.pathname === '/api/auth/csrf') return reply({});
      if (url.pathname.startsWith('/api/draft/')) {
        if (!connected) return reply({ error: 'Connection unavailable. Reconnecting…' }, 503);
        return reply(snapshot());
      }
      if (url.pathname.startsWith('/api/command/')) {
        const payload = route.request().postDataJSON();
        if (url.pathname.endsWith('rename_my_fantasy_team')) {
          teams[0].name = payload.p_name;
          return reply({ team_id: teamId, name: payload.p_name });
        }
        if (url.pathname.endsWith('set_draft_queue')) {
          queue = payload.p_athlete_ids;
          return reply({ queue });
        }
        if (url.pathname.endsWith('make_draft_pick')) {
          pendingPick = true;
          await new Promise((resolve) => setTimeout(resolve, 350));
          picks.push({
            id: 'pick-1',
            draft_id: draftId,
            fantasy_team_id: teamId,
            athlete_id: payload.p_athlete_id,
            overall_pick: 1,
            round: 1,
            pick_in_round: 1,
            source: 'manager',
            created_at: new Date().toISOString(),
          });
          pendingPick = false;
          return reply({ pick_id: 'pick-1' });
        }
        return reply({});
      }
      if (url.pathname === '/api/data/supabase') {
        const dataPath = new URL(url.searchParams.get('path'), origin);
        const table = dataPath.pathname.split('/').at(-1);
        if (scenario === 'loading' && table === 'athletes')
          await new Promise((resolve) => setTimeout(resolve, 1100));
        if (scenario === 'error' && table === 'athletes')
          return reply({ message: 'Fixture failure' }, 503);
        if (dataPath.searchParams.get('select')?.includes('supplied_adp'))
          return reply({ message: 'Missing supplied_adp column' }, 400);
        if (table === 'athletes') {
          if (scenario === 'empty') return reply([]);
          const id = dataPath.searchParams.get('id')?.replace('eq.', '');
          return reply(id ? players.find((p) => p.id === id) : players);
        }
        if (table === 'get_pool_adp')
          return scenario === 'adp-error'
            ? reply({ message: 'New ADP RPC not installed' }, 404)
            : reply(Object.fromEntries(players.map((player) => [player.id, player.adp])));
        if (table === 'get_draft_results')
          return reply({
            league: { id: leagueId, name: league.name },
            picks: [
              {
                id: 'fixture-result',
                athlete_id: players[0].id,
                display_name: players[0].display_name,
                bio: players[0].bio,
                program: players[0].program,
                overall_pick: 1,
                round: 1,
                pick_in_round: 1,
                source: 'manager',
                team_name: teams[0].name,
              },
            ],
          });
        if (table === 'competitions')
          return reply([
            {
              id: 'c',
              division: 'womens',
              name: "Brock Women's Volleyball",
              season_label: '2026-27',
              is_active: true,
              ruleset_id: league.ruleset_id,
              sports: { code: 'volleyball' },
            },
          ]);
        if (table === 'games')
          return reply([
            {
              id: 'g',
              competition_id: 'c',
              starts_at: new Date(Date.now() + 3600_000).toISOString(),
              status: 'scheduled',
            },
          ]);
        if (table === 'scoring_rulesets') return reply({ draft_config: { pickSeconds: 120 } });
        if (table === 'roster_slot_rules') return reply([{ slot_count: 10 }]);
        if (
          table === 'roster_entries' &&
          dataPath.searchParams.get('select')?.includes('competition:competitions(')
        )
          return reply({ code: 'PGRST201', message: 'Ambiguous competition relationship' }, 300);
        if (table === 'normalized_player_game_stats')
          return reply([
            {
              game_id: 'fixture-game-a',
              stats: {},
              fantasy_points: 2,
              complete: true,
              missing_stats: [],
              updated_at: new Date().toISOString(),
              game: {
                id: 'fixture-game-a',
                starts_at: new Date(Date.now() - 86400_000).toISOString(),
                status: 'final',
              },
            },
            {
              game_id: 'fixture-game-b',
              stats: {},
              fantasy_points: 5,
              complete: true,
              missing_stats: [],
              updated_at: new Date().toISOString(),
              game: {
                id: 'fixture-game-b',
                starts_at: new Date(Date.now() - 172800_000).toISOString(),
                status: 'final',
              },
            },
          ]);
        if (table === 'fantasy_point_events')
          return reply([
            {
              game_id: 'fixture-game-a',
              points: 3,
              stat_key: 'goals',
              created_at: new Date().toISOString(),
            },
            {
              game_id: 'fixture-game-a',
              points: -1,
              stat_key: 'penalty_minutes',
              created_at: new Date().toISOString(),
            },
            {
              game_id: 'fixture-game-b',
              points: 5,
              stat_key: 'assists',
              created_at: new Date().toISOString(),
            },
          ]);
        if (table === 'roster_entries')
          return reply([
            {
              id: 'roster-entry',
              fantasy_team_id: teamId,
              athlete_id: players[0].id,
              slot_code: 'VB_HT',
              status: 'starter',
              athlete: { ...players[0], competition: { name: "Brock Women's Volleyball" } },
            },
          ]);
        if (table === 'leagues') {
          const row = { ...league, commissioner_id: commissioner ? userId : otherTeam };
          return reply(dataPath.searchParams.has('id') ? row : [row]);
        }
        if (table === 'drafts')
          return reply([
            { id: draftId, league_id: leagueId, status: complete ? 'complete' : 'active' },
          ]);
        if (table === 'fantasy_teams') return reply(teams);
        if (table === 'athlete_seasons')
          return reply([{ competition_id: 'c', team_id: 't', positions: ['HT'] }]);
        if (table === 'athlete_season_summaries')
          return reply(
            players.find((p) => dataPath.searchParams.get('athlete_id')?.endsWith(p.id))
              ?.summaries ?? [],
          );
        if (table === 'weekly_projections') return reply(null);
        return reply([], 200, { 'content-range': '0-0/0' });
      }
      // Auth forms and their real server rendering are tested without browser API fixtures.
      return route.continue();
    });
    const page = await context.newPage();
    lastPage = page;
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await page.goto(origin + '/players', { waitUntil: 'domcontentloaded' });
      await page.getByText(players[0].display_name, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.brockTheme), theme);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Overflow: players ${theme} ${width}`,
      );
      const playerRows = page
        .getByRole('link')
        .filter({ has: page.getByText('Projected FP', { exact: true }) });
      assert.ok(
        await playerRows
          .first()
          .evaluate(
            (element) => parseFloat(window.getComputedStyle(element).borderBottomWidth) > 0,
          ),
        'Player rows have separators between entries',
      );
      assert.equal(
        await playerRows
          .last()
          .evaluate((element) => parseFloat(window.getComputedStyle(element).borderBottomWidth)),
        0,
        'Last player row has no trailing separator',
      );
      await page
        .getByRole('textbox', { name: 'Search players', exact: true })
        .fill(players[0].display_name);
      await page.getByText('1 shown', { exact: true }).waitFor();
      assert.equal(
        await playerRows
          .first()
          .evaluate((element) => parseFloat(window.getComputedStyle(element).borderBottomWidth)),
        0,
        'A filtered single player has no separator',
      );
      await page.getByRole('textbox', { name: 'Search players', exact: true }).fill('');
      await page.screenshot({ path: path.join(output, `players-${theme}-${width}.png`) });
      if (width === 390 || width === 1440) {
        const themeToggle = page.getByRole('button', {
          name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
        });
        await themeToggle.focus();
        await page.keyboard.press('Tab');
        assert.ok(
          await page.evaluate(() => document.activeElement !== document.body),
          'Keyboard focus remains on an interactive control',
        );
        const analysis = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        accessibility.push({
          theme,
          width,
          violations: analysis.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        });
      }
      results.push(`players ${theme} ${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/dashboard');
    await page.getByText('Badgers Club', { exact: true }).waitFor();
    await page.getByText(/Next game ·/).waitFor();
    await page.screenshot({ path: path.join(output, `dashboard-${theme}.png`) });
    const withHeight = players.find((p) => p.bio.height);
    await page.goto(origin + '/players/' + withHeight.id);
    await page.getByText('Height ·', { exact: false }).waitFor();
    await page.getByText('No recorded picks yet', { exact: true }).waitFor();
    await page.getByText('2.0 pts', { exact: true }).waitFor();
    const historyRow = (label) =>
      page.getByText(label, { exact: true }).locator('..').locator('..');
    assert.ok(
      await historyRow('2026-27 · supplied projection').evaluate(
        (element) => parseFloat(window.getComputedStyle(element).borderBottomWidth) > 0,
      ),
      'Historical records retain internal separators',
    );
    assert.equal(
      await historyRow('2025-26 · historical').evaluate((element) =>
        parseFloat(window.getComputedStyle(element).borderBottomWidth),
      ),
      0,
      'Last history record has no trailing separator',
    );
    await page.getByText('2026-27', { exact: true }).click();
    assert.equal(
      await historyRow('2026-27 · supplied projection').evaluate((element) =>
        parseFloat(window.getComputedStyle(element).borderBottomWidth),
      ),
      0,
      'Filtered history omits its final separator',
    );
    const forecast = await page
      .getByText('Weekly projections are not available yet.', { exact: true })
      .locator('..')
      .boundingBox();
    const back = await page
      .getByRole('link', { name: 'Back to players', exact: true })
      .boundingBox();
    assert.ok(
      back.y - forecast.y - forecast.height >= 16,
      'Forecast and return button have vertical spacing',
    );
    await page.screenshot({ path: path.join(output, `player-detail-${theme}.png`) });
    const seeded = players.find((player) => player.adp.base !== null);
    await page.goto(origin + '/players/' + seeded.id);
    await page.getByText('Supplied starting value', { exact: true }).waitFor();
    assert.equal(
      await page.getByText(seeded.adp.base.toFixed(1), { exact: true }).count(),
      1,
      'Supplied ADP displays on the player profile',
    );
    for (const state of ['loading', 'empty', 'error']) {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        scenario = state;
        await page.goto(origin + '/players');
        await page
          .getByText(
            state === 'loading'
              ? 'Loading the current Brock rosters…'
              : state === 'empty'
                ? 'No player records yet'
                : 'Unable to load the player list. Try again.',
            { exact: true },
          )
          .waitFor();
        await page.screenshot({
          path: path.join(output, `players-${theme}-${state}-${width}.png`),
        });
      }
    }
    scenario = 'populated';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/draft/' + draftId);
    await page.getByText('Available players', { exact: true }).waitFor();
    await page.getByRole('button', { name: '+ Queue', exact: true }).first().click();
    await page.waitForFunction(() => document.body.textContent.includes('Remove from queue'));
    assert.equal(queue.length, 1);
    await page
      .getByRole('link', { name: 'View ' + players[0].display_name + ' player details' })
      .click();
    await page.getByRole('button', { name: 'Close player details' }).waitFor();
    await page.screenshot({ path: path.join(output, `draft-details-${theme}.png`) });
    await page.getByRole('button', { name: 'Close player details' }).click();
    await page.screenshot({ path: path.join(output, `draft-${theme}-1440.png`) });
    await page.getByRole('button', { name: 'Draft', exact: true }).first().click();
    assert.equal(pendingPick, true);
    assert.equal(await page.getByText(/Your pick is confirmed/).count(), 0);
    await page.getByText(/Your pick is confirmed/).waitFor();
    assert.equal(picks.length, 1);
    connected = false;
    await page
      .getByText('RECONNECTING · PICKS DISABLED', { exact: true })
      .waitFor({ timeout: 20000 });
    assert.equal(
      await page.getByRole('button', { name: 'Wait', exact: true }).first().isDisabled(),
      true,
    );
    await page.screenshot({ path: path.join(output, `draft-${theme}-reconnecting.png`) });
    connected = true;
    expired = true;
    picks = [];
    await page.getByRole('button', { name: 'Retry connection' }).click();
    await page.getByText('Your pick timed out. Awaiting autopick…', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Draft', exact: true }).first().isDisabled(),
      true,
    );
    expired = false;
    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin + '/draft/' + draftId);
      await page.getByText('Available players', { exact: true }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Overflow: draft ${theme} ${width}`,
      );
      await page.screenshot({ path: path.join(output, `draft-${theme}-${width}.png`) });
    }
    complete = true;
    await page.goto(origin + '/draft/' + draftId);
    await page.waitForURL('**/draft-results/' + draftId);
    await page.getByText('All draft picks', { exact: true }).waitFor();
    assert.equal(await page.getByText('Available players', { exact: true }).count(), 0);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      commissioner = true;
      await page.goto(origin + '/league/' + leagueId);
      await page.getByRole('tab', { name: 'settings', exact: true }).click();
      await page.getByText('Commissioner settings', { exact: true }).waitFor();
      const transactionLink = page.getByRole('link', {
        name: 'Free agents, waivers & trades',
        exact: true,
      });
      const transactionBounds = await transactionLink.boundingBox();
      assert.ok(
        transactionBounds.x >= 0 && transactionBounds.x + transactionBounds.width <= width,
        'Manager controls stay inside the phone width',
      );
      assert.ok(
        await transactionLink.evaluate((element) => element.scrollWidth <= element.clientWidth),
        'Manager button text fits its control',
      );
      assert.equal(
        await page.getByRole('link', { name: 'Open draft room', exact: true }).count(),
        0,
      );
      await page.getByRole('link', { name: 'View draft results', exact: true }).first().waitFor();
      await page.getByRole('textbox', { name: 'Your team name', exact: true }).fill('New Badgers');
      if (teams[0].name !== 'New Badgers') {
        await page.getByRole('button', { name: 'Save team name', exact: true }).click();
        await page.getByText('Team name saved.', { exact: true }).waitFor();
        assert.equal(teams[0].name, 'New Badgers');
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `Overflow: settings ${theme} ${width}`,
      );
      await page.screenshot({ path: path.join(output, `league-settings-${theme}-${width}.png`) });
      await page.getByRole('tab', { name: 'roster', exact: true }).click();
      await page.getByText(/Women's Volleyball · HT · VB_HT/).waitFor();
      await page.screenshot({ path: path.join(output, `league-roster-${theme}-${width}.png`) });
      commissioner = false;
      await page.goto(origin + '/league/' + leagueId);
      await page.getByRole('tab', { name: 'settings', exact: true }).click();
      await page.getByText('Manager settings', { exact: true }).waitFor();
      assert.equal(await page.getByText('Commissioner settings', { exact: true }).count(), 0);
      assert.equal(
        await page.getByRole('button', { name: 'Delete league', exact: true }).count(),
        0,
      );
      await page.goto(origin + '/notifications');
      await page.getByText('No notifications', { exact: true }).waitFor();
      const filters = await page
        .getByRole('button', { name: 'All updates', exact: true })
        .boundingBox();
      const empty = await page.getByText('No notifications', { exact: true }).boundingBox();
      assert.ok(
        empty.y > filters.y + filters.height + 20,
        'Notification filters have space below them',
      );
      await page.screenshot({ path: path.join(output, `notifications-${theme}-${width}.png`) });
      if (width === 1440) {
        const privacy = await page.getByText('Privacy', { exact: true }).boundingBox();
        const instagram = await page
          .getByRole('link', { name: /Brock Fantasy Association on Instagram/ })
          .boundingBox();
        assert.ok(
          Math.abs(privacy.y + privacy.height / 2 - (instagram.y + instagram.height / 2)) < 3,
          'Footer links align',
        );
      }
    }
    scenario = 'adp-error';
    await page.goto(origin + '/players');
    await page.getByText(players[0].display_name, { exact: true }).waitFor();
    await page
      .getByText('Average draft positions are temporarily unavailable.', { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText('Unable to load the player list. Try again.', { exact: true }).count(),
      0,
    );
    await context.close();
    results.push(
      `settings/results/roster/notifications ${theme}: commissioner visibility, rename, completed-room redirect, ADP rollout tolerance`,
    );
    results.push(`draft ${theme}: queue, details, acknowledged pick, expired clock, reconnect`);
  }
  // Real server forms: theme readback, local fonts, responsive layout and CSP.
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    await context.addCookies([{ name: 'bf_theme', value: theme, url: origin }]);
    const page = await context.newPage();
    for (const route of ['/auth', '/forgot-password']) {
      await page.goto(origin + route);
      await page.locator('h1').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.brockTheme), theme);
      await page.screenshot({ path: path.join(output, `${route.slice(1)}-${theme}-390.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/auth');
    await page.screenshot({ path: path.join(output, `auth-${theme}-1440.png`) });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const bundles = await readdir('apps/client/dist/client/_expo/static/js/web');
  const sizes = await Promise.all(
    bundles
      .filter((file) => file.endsWith('.js'))
      .map(
        async (file) =>
          (await stat(path.join('apps/client/dist/client/_expo/static/js/web', file))).size,
      ),
  );
  const report = {
    results,
    errors,
    baselineJavaScriptBytes: 2240100,
    currentJavaScriptBytes: sizes.reduce((a, b) => a + b, 0),
    screenshots: (await readdir(output)).filter((file) => file.endsWith('.png')).length,
    hostedJourneys: false,
    accessibility,
  };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  assert.ok(
    accessibility.every((entry) => entry.violations.length === 0),
    JSON.stringify(accessibility),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(error.stack);
  console.log(
    JSON.stringify({
      errors,
      url: lastPage?.url(),
      body:
        lastPage && !lastPage.isClosed() ? await lastPage.locator('body').innerText() : undefined,
    }),
  );
  if (lastPage && !lastPage.isClosed())
    await lastPage.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
