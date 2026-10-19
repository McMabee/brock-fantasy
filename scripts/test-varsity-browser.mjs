/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Use synthetic API fixtures so UI verification needs no private CSVs or hosted account
const userId = '11111111-1111-4111-8111-111111111111';
const leagueId = '22222222-2222-4222-8222-222222222222';
const teamId = '33333333-3333-4333-8333-333333333333';
const poolId = 'b0000000-0000-4000-8000-000000000003';
const programNames = {
  mens_hockey: "Men's Hockey",
  womens_hockey: "Women's Hockey",
  mens_basketball: "Men's Basketball",
  womens_basketball: "Women's Basketball",
  mens_volleyball: "Men's Volleyball",
  womens_volleyball: "Women's Volleyball",
};
const fixture = [
  ['Alpha Forward', 'mens_hockey', 'F'],
  ['Bravo Goalie', 'womens_hockey', 'G'],
  ['Charlie Guard', 'mens_basketball', 'BC'],
  ['Delta Centre', 'womens_basketball', 'FC'],
  ['Echo Hitter', 'mens_volleyball', 'HT'],
  ['Foxtrot Setter', 'mens_volleyball', 'S'],
  ['Golf Forward', 'mens_hockey', 'F'],
  ['Hotel Guard', 'mens_basketball', 'BC'],
  ['India Libero', 'mens_volleyball', 'L'],
  ['Juliet Defence', 'womens_hockey', 'D'],
  ['Zulu Free Guard', 'womens_basketball', 'BC'],
  ['Able Free Hitter', 'mens_volleyball', 'HT'],
  ['Own Program Libero', 'womens_volleyball', 'L'],
  ['Missing Projection', 'mens_hockey', 'F'],
];
const players = fixture.map(([displayName, program, position], index) => ({
  id: `athlete-${index}`,
  displayName,
  program: programNames[program],
  position,
  positions: [position],
  team: 'Brock Badgers',
  teamId: program,
  competitionId: program,
  jerseyNumber: String(index + 1),
  bio: { program, headshot: { url: 'https://gobadgers.ca/images/fixture.png' }, height: '180 cm' },
  seasonPoints: index + 7,
  seasonStats: { assists: 4, digs: 12 },
  seasonProjection: 200 - index,
  nextProjection: index === 13 ? null : index === 10 ? 999 : 100 - index,
  projectedGames: 20,
  scheduledGames: 2,
  period: { number: 1, startsAt: '2026-10-24T04:00:00Z', endsAt: '2026-11-01T04:00:00Z' },
  pending: false,
  adp: 30 - index,
  nextGame: null,
}));
const row = (player) => ({
  id: player.id,
  display_name: player.displayName,
  position: player.position,
  bio: player.bio,
  competition: { name: player.program },
  team: { name: player.team },
});
const codes = ['HK_F', 'HK_DG', 'BB_BC', 'BB_FC', 'VB_HT', 'VB_LS', 'FLEX', 'BN', 'BN', 'BN'];
const rules = Object.entries({
  HK_F: ['F', 'D', 'G'],
  HK_DG: ['F', 'D', 'G'],
  BB_BC: ['BC', 'FC'],
  BB_FC: ['BC', 'FC'],
  VB_HT: ['HT', 'L', 'S'],
  VB_LS: ['HT', 'L', 'S'],
  FLEX: ['F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S'],
  BN: ['F', 'D', 'G', 'BC', 'FC', 'HT', 'L', 'S'],
}).map(([slot_code, allowed_positions]) => ({
  slot_code,
  allowed_positions,
  label: slot_code.startsWith('HK')
    ? 'Hockey - any position'
    : slot_code.startsWith('BB')
      ? 'Basketball - any position'
      : 'Any eligible position',
  slot_count: slot_code === 'BN' ? 3 : 1,
  is_starter: slot_code !== 'BN',
}));
const root = path.resolve('apps/client/dist/client');
const output = path.resolve('dev/tmp/varsity-browser');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    const file = path.resolve(root, '.' + name);
    const types = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
    };
    const mime = types[path.extname(file)];
    if (file.startsWith(root + path.sep) && mime) {
      res.writeHead(200, { 'content-type': mime });
      res.end(await readFile(file));
      return;
    }
    await handler(req, res);
  } catch {
    res.writeHead(500);
    res.end('Local fixture server failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = {
  hostedJourneys: false,
  checks: [],
  screenshots: [],
  errors: [],
  accessibility: [],
};
let lastPage;
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'no-preference',
    });
    await context.addCookies([
      { name: 'bf_theme', value: theme, url: origin },
      { name: 'bf_csrf', value: 'fixture-csrf', url: origin },
    ]);
    let participant = {
      id: userId,
      display_name: 'Varsity Manager',
      email: 'fixture@example.test',
      role: 'coach',
      programs: ['womens_volleyball'],
      revision: 1,
    };
    const roster = players.slice(0, 10).map((player, index) => ({
      id: `entry-${index}`,
      fantasy_team_id: teamId,
      athlete_id: player.id,
      slot_code: codes[index],
      status: codes[index] === 'BN' ? 'bench' : 'starter',
      athlete: row(player),
    }));
    const commands = [];
    let scheduled = false;
    const inbox = [
      {
        id: 'historical-inbox',
        kind: 'trade_proposed',
        title: 'Old trade notification',
        body: 'Historical event',
        data: { league_id: leagueId },
        read_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    await context.route('https://gobadgers.ca/images/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (process.env.BROCK_BROWSER_DEBUG) console.log(url.pathname, url.searchParams.get('path'));
      const reply = (body) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: JSON.stringify(body),
        });
      if (url.pathname === '/api/auth/session')
        return reply({
          user: { id: userId, email: participant.email },
          expiresAt: Date.now() + 3600000,
        });
      if (url.pathname === '/api/auth/csrf') return reply({});
      if (url.pathname === '/api/admin/status')
        return reply({ authenticated: true, hasAdminRole: true, isAdmin: true, aal: 'aal2' });
      if (url.pathname.startsWith('/api/command/')) {
        const payload = route.request().postDataJSON();
        const name = url.pathname.split('/').at(-1);
        commands.push({ name, payload });
        if (name === 'confirm_matchup_schedule') scheduled = true;
        if (name === 'join_league') return reply({ league_id: leagueId });
        if (name === 'admin_set_participation')
          participant = {
            ...participant,
            role: payload.p_role,
            programs: payload.p_programs,
            revision: participant.revision + 1,
          };
        if (name === 'add_free_agent') {
          const target = roster.findIndex((entry) => entry.athlete_id === payload.p_athlete_out_id);
          const athlete = players.find((player) => player.id === payload.p_athlete_in_id);
          if (target >= 0 && athlete)
            roster[target] = { ...roster[target], athlete_id: athlete.id, athlete: row(athlete) };
        }
        return reply(
          name === 'propose_trade'
            ? { trade_id: `fixture-trade-${commands.length}` }
            : { revision: participant.revision },
        );
      }
      if (url.pathname === '/api/data/supabase') {
        const data = new URL(url.searchParams.get('path'), origin);
        const table = data.pathname.split('/').at(-1);
        if (table === 'get_my_participation')
          return reply({
            role: participant.role,
            programs: participant.programs,
            revision: participant.revision,
            displayName: participant.display_name,
          });
        if (table === 'admin_find_participants') return reply([participant]);
        if (table === 'get_player_insights') return reply(players);
        if (table === 'notifications') return reply(inbox);
        if (table === 'get_player_forecast')
          return reply({
            projectedSeasonPoints: 200,
            projectedGames: 20,
            knownSchedule: true,
            periods: [
              {
                id: 'forecast-period',
                number: 1,
                startsAt: '2026-10-24T04:00:00Z',
                endsAt: '2026-11-01T04:00:00Z',
              },
            ],
            games: [
              {
                id: 'forecast-game',
                startsAt: '2026-10-25T23:00:00Z',
                status: 'scheduled',
                opponent: 'Fixture opponents',
                pending: false,
                complete: false,
                actualPoints: null,
              },
            ],
          });
        if (table === 'get_player_trade_options')
          return reply([
            {
              league_id: leagueId,
              league_name: 'Varsity League',
              proposing_team_id: teamId,
              receiving_team_id: 'opponent-team',
              receiving_team_name: 'Other Badgers',
              athlete_name: 'Zulu Free Guard',
              offered: [{ id: 'athlete-7', name: 'Hotel Guard' }],
            },
          ]);
        if (table === 'get_preseason_rankings')
          return reply({
            publication: { version: 1, published_at: '2026-10-19T12:00:00Z' },
            rows: [
              {
                athlete_id: 'athlete-10',
                name: 'Zulu Free Guard',
                position: 'BC',
                program: 'womens_basketball',
                position_group: 'BB_BC',
                projected_points: 190,
                position_rank: 1,
              },
              {
                athlete_id: 'athlete-13',
                name: 'Missing Projection',
                position: 'F',
                program: 'mens_hockey',
                position_group: 'HK_F',
                projected_points: null,
                position_rank: null,
              },
            ],
          });
        if (table === 'get_historical_game_logs')
          return reply([
            {
              source_game_id: '1',
              played_at: '2025-11-01T23:00:00Z',
              opponent: 'Archive opponents',
              phase: 'regular',
              result: 'W, 3-1',
              stats: { goals: 1, assists: 0 },
              complete: false,
              fantasy_points: null,
              missing_stats: ['power_play_goals'],
              source_url:
                'https://gobadgers.ca/sports/mens-ice-hockey/stats/2025-26/fixture/boxscore/1',
              scoring_version: 'brock-2026.2',
            },
          ]);
        if (table === 'athletes')
          return reply(
            data.searchParams.has('id')
              ? { ...row(players[10]), jersey_number: '11', status: 'active' }
              : players.map((player) => ({
                  ...row(player),
                  jersey_number: player.jerseyNumber,
                  summaries: [],
                })),
          );
        if (table === 'get_matchup_preview')
          return reply({
            signature: 'fixture-schedule-signature',
            shortened: true,
            can_generate: true,
            periods: [
              { number: 1, starts_at: '2026-10-24T04:00:00Z', ends_at: '2026-11-01T04:00:00Z' },
            ],
            pairings: [{ period: 1, home_team_id: teamId, away_team_id: 'opponent-team' }],
          });
        if (table === 'matchups')
          return reply(
            scheduled
              ? [
                  {
                    id: '44444444-4444-4444-8444-444444444444',
                    league_id: leagueId,
                    period: 1,
                    home_team_id: teamId,
                    away_team_id: 'opponent-team',
                    home_points: 12,
                    away_points: 9,
                    status: 'scheduled',
                    starts_at: '2026-10-24T04:00:00Z',
                    ends_at: '2026-11-01T04:00:00Z',
                  },
                ]
              : [],
          );
        if (table === 'get_matchup_detail')
          return reply({
            teams: [
              {
                id: teamId,
                name: 'Varsity Badgers',
                contributors: [
                  { athlete_id: 'athlete-8', name: 'Former Contributor', points: 12, games: 1 },
                ],
                roster: [
                  {
                    athlete_id: 'athlete-10',
                    name: 'Current Starter',
                    slot: 'FLEX',
                    status: 'starter',
                  },
                ],
              },
              {
                id: 'opponent-team',
                name: 'Other Badgers',
                contributors: [
                  { athlete_id: 'athlete-9', name: 'Other Contributor', points: 9, games: 1 },
                ],
                roster: [],
              },
            ],
          });
        if (table === 'leagues' && data.searchParams.has('invite_code')) return reply(null);
        if (table === 'leagues')
          return reply({
            id: leagueId,
            competition_id: null,
            pool_id: poolId,
            commissioner_id: userId,
            ruleset_id: 'fixture-rules',
            name: 'Varsity League',
            format: 'head_to_head',
            status: 'active',
            max_members: 8,
            invite_code: 'FIXTURE',
            state_version: 1,
            roster_format: 'varsity',
          });
        if (table === 'fantasy_teams')
          return reply([
            {
              id: 'opponent-team',
              league_id: leagueId,
              owner_id: 'other-owner',
              name: 'Other Badgers',
              draft_position: 2,
              owner: { display_name: 'Other Manager', is_varsity: false },
            },
            {
              id: teamId,
              league_id: leagueId,
              owner_id: userId,
              name: 'Varsity Badgers',
              draft_position: 1,
              owner: {
                display_name: participant.display_name,
                is_varsity: participant.role !== 'none',
              },
            },
          ]);
        if (table === 'drafts') return reply({ id: 'fixture-draft', status: 'complete' });
        if (table === 'roster_entries') return reply(roster);
        if (table === 'pool_rankings')
          return reply(players.map((player) => ({ athlete: row(player) })));
        if (table === 'scoring_rulesets')
          return reply({
            transaction_config: {
              freeAgentsEnabled: true,
              waiversEnabled: true,
              tradesEnabled: false,
            },
          });
        if (table === 'roster_slot_rules') return reply(rules);
        if (table === 'get_beta_lineup')
          return reply({
            period: null,
            state_version: 1,
            entries: roster.map((entry) => ({
              athlete_id: entry.athlete_id,
              display_name: entry.athlete.display_name,
              positions: players.find((player) => player.id === entry.athlete_id).positions,
              slot_code: entry.slot_code,
              status: entry.status,
              locked: false,
              locks_at: null,
              participation_conflict: false,
            })),
          });
        return reply([]);
      }
      return reply({});
    });
    const page = await context.newPage();
    lastPage = page;
    page.on('pageerror', (error) => report.errors.push(error.message));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
      await page.goto(`${origin}/transactions/${leagueId}`);
      const buttons = page.getByRole('button', { name: /^Insights for / });
      await buttons.first().waitFor();
      assert.equal(
        await buttons.first().getAttribute('aria-label'),
        'Insights for Zulu Free Guard',
      );
      await page.getByRole('radio', { name: 'Name', exact: true }).click();
      assert.equal(
        await buttons.first().getAttribute('aria-label'),
        'Insights for Able Free Hitter',
      );
      await page.getByRole('radio', { name: 'Next-period projection', exact: true }).click();
      assert.equal(
        await buttons.first().getAttribute('aria-label'),
        'Insights for Zulu Free Guard',
      );
      await page.getByRole('radio', { name: "Women's Volleyball", exact: true }).click();
      assert.equal(await buttons.count(), 1);
      assert.equal(
        await page.getByRole('button', { name: 'Add now', exact: true }).isDisabled(),
        true,
      );
      await page
        .getByText('Your varsity program · unavailable to your account', { exact: true })
        .waitFor();
      await page.getByRole('radio', { name: 'All programs', exact: true }).click();
      const bug = page.getByRole('link', { name: 'Report a bug or suggestion', exact: true });
      const beforeBug = await bug.boundingBox();
      await page.evaluate(() =>
        document.querySelectorAll('div').forEach((element) => {
          if (element.scrollHeight > element.clientHeight + 100) element.scrollTop = 500;
        }),
      );
      const afterBug = await bug.boundingBox();
      assert.equal(
        Math.round(beforeBug.y),
        Math.round(afterBug.y),
        'Feedback button stays fixed after scrolling',
      );
      assert.equal(Math.round(afterBug.width), 52);
      assert.ok(afterBug.x + afterBug.width <= width);
      await page.evaluate(() =>
        document.querySelectorAll('div').forEach((element) => {
          if (element.scrollTop) element.scrollTop = 0;
        }),
      );
      const first = buttons.first();
      assert.equal(await first.getByRole('img').count(), 1);
      const font = await first
        .locator('div')
        .filter({ hasText: 'Zulu Free Guard' })
        .last()
        .evaluate((element) => ({
          size: parseFloat(getComputedStyle(element).fontSize),
          family: getComputedStyle(element).fontFamily,
        }));
      assert.ok(
        font.size >= 16 && font.family.includes('Inter'),
        'Athlete names use the app body font at readable size',
      );
      await first.click();
      const panel = page.locator('#athlete-insights-panel');
      await page.getByText('Published season statistics', { exact: true }).waitFor();
      await page.waitForTimeout(350);
      const box = await panel.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(
        Math.abs(box.x + box.width / 2 - viewport.width / 2) < 3,
        'Insights are horizontally centered',
      );
      assert.ok(
        Math.abs(box.y + box.height / 2 - viewport.height / 2) < 3,
        'Insights are vertically centered',
      );
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'Insights fit the viewport');
      const analysis = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      report.accessibility.push({
        page: 'insights',
        theme,
        width,
        violations: analysis.violations,
      });
      const image = `insights-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(output, image) });
      report.screenshots.push(image);
      assert.equal(
        await page.getByText('Old trade notification', { exact: true }).count(),
        0,
        'Historical notifications are not replayed on login',
      );
      await panel.getByRole('button', { name: 'Trade', exact: true }).click();
      await page.getByText('Request Zulu Free Guard from Other Badgers', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Hotel Guard', exact: true }).click();
      await page.getByRole('button', { name: 'Send trade proposal', exact: true }).click();
      await page
        .getByText(/Trade proposal sent$/u)
        .first()
        .waitFor();
      await page.getByRole('button', { name: 'Dismiss notification', exact: true }).first().click();
      const definition = page
        .getByRole('button', { name: 'About Waiver claims', exact: true })
        .first();
      await definition.focus();
      await page.getByText('Waiver claims', { exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByText('Waiver claims', { exact: true }).waitFor({ state: 'hidden' });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      const listImage = `transactions-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(output, listImage), fullPage: true });
      report.screenshots.push(listImage);
      console.log(`Verified transactions ${theme} ${width}`);
      report.checks.push(
        `Transactions ${theme} ${width}: filters, immediate sorting, photos, team names, program restriction, typography, centered animated statistics`,
      );
    }
    await page.getByRole('radio', { name: 'Hotel Guard · Guard / backcourt', exact: true }).click();
    await page.getByRole('button', { name: 'Add now', exact: true }).first().click();
    await page.getByText('Athlete added to your roster.', { exact: true }).first().waitFor();
    const acquisition = commands.find((command) => command.name === 'add_free_agent');
    assert.equal(acquisition.payload.p_athlete_in_id, 'athlete-10');
    assert.equal(acquisition.payload.p_athlete_out_id, 'athlete-7');
    assert.equal(
      await page.getByRole('button', { name: 'Insights for Zulu Free Guard', exact: true }).count(),
      0,
    );
    report.checks.push(
      `Acquisition ${theme}: explicit drop, atomic add request, refreshed available athletes`,
    );
    await page.goto(origin + '/players');
    await page.getByRole('button', { name: 'Preseason rankings', exact: true }).click();
    await page.getByText('Reviewed snapshot v1', { exact: false }).waitFor();
    await page.getByText('Unranked · Projection unavailable', { exact: true }).waitFor();
    await page
      .getByRole('textbox', { name: 'Search preseason rankings', exact: true })
      .fill('Zulu');
    assert.equal(
      await page.getByText('Unranked · Projection unavailable', { exact: true }).count(),
      0,
    );
    await page.goto(origin + '/players/athlete-10');
    await page.getByText('2025–26 Brock game logs', { exact: true }).waitFor();
    await page
      .getByText('Required statistics missing: power play goals', { exact: true })
      .waitFor();
    await page.getByText('Estimated finish: 10.0 pts', { exact: true }).waitFor();
    await page.goto(origin + '/league/' + leagueId);
    await page.getByRole('button', { name: 'Preview matchup schedule', exact: true }).click();
    await page.getByText('Shortened season:', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Confirm matchup schedule', exact: true }).click();
    assert.ok(
      commands.some(
        (command) =>
          command.name === 'confirm_matchup_schedule' &&
          command.payload.p_expected_signature === 'fixture-schedule-signature',
      ),
    );
    report.checks.push(
      `Backlog ${theme}: profile trade, inline definitions, forecast, historical missing statistics, reviewed rankings, shortened schedule confirmation, fixed feedback at 320–1440px`,
    );
    await page.goto(origin + '/matchups/' + leagueId);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const sections = page.getByText('Earned contributions this period', { exact: true });
      await sections.nth(1).waitFor();
      await page.getByRole('link', { name: 'Former Contributor', exact: true }).waitFor();
      await expect
        .poll(
          async () => {
            const first = await sections.nth(0).boundingBox(),
              second = await sections.nth(1).boundingBox();
            return width === 320
              ? Math.abs(first.x - second.x) < 2 && second.y > first.y
              : second.x > first.x + 100;
          },
          { message: 'Matchup rosters stack on phones and align beside each other on desktop' },
        )
        .toBe(true);
      const firstCard = await sections.nth(0).locator('..').boundingBox();
      const benchLabel = await page
        .getByText('Current saved bench · bench games do not score', { exact: true })
        .first()
        .boundingBox();
      assert.ok(
        benchLabel.y + benchLabel.height <= firstCard.y + firstCard.height - 12,
        'Wrapped roster labels remain inside their card',
      );
      await page.screenshot({
        path: path.join(output, `matchups-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    inbox.unshift({
      id: 'fresh-waiver',
      kind: 'waiver_result',
      title: 'Fresh waiver outcome',
      body: 'Your fixture claim succeeded',
      data: { league_id: leagueId },
      read_at: null,
      created_at: new Date().toISOString(),
    });
    const popup = page.getByText(/Fresh waiver outcome$/u);
    await popup.waitFor();
    await popup.hover();
    await page.waitForTimeout(6500);
    assert.ok(await popup.isVisible(), 'Hover pauses the six-second dismissal');
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).first().click();
    assert.ok(
      !commands.some((command) => command.name === 'mark_notification_read'),
      'Dismissing a popup does not mark the inbox read',
    );
    await page.waitForTimeout(5200);
    assert.equal(await popup.count(), 0, 'Polling does not replay a dismissed event');
    await page.screenshot({
      path: path.join(output, `backlog-league-${theme}.png`),
      fullPage: true,
    });
    await page.goto(origin + '/admin/participants');
    await page
      .getByRole('textbox', { name: 'Find participant by name or email', exact: true })
      .fill('Varsity');
    await page.getByRole('button', { name: 'Find accounts', exact: true }).click();
    await page
      .getByRole('button', { name: 'Edit participation for Varsity Manager', exact: true })
      .click();
    await page.getByRole('radio', { name: 'Varsity athlete', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Reason for participation correction', exact: true })
      .fill('Confirmed membership with the participant');
    await page.getByRole('button', { name: 'Save participation', exact: true }).click();
    await page
      .getByText('Participation saved. League formats and teammate restrictions are updated.', {
        exact: true,
      })
      .waitFor();
    const saved = commands.find((command) => command.name === 'admin_set_participation');
    assert.equal(saved.payload.p_role, 'athlete');
    assert.deepEqual(saved.payload.p_programs, ['womens_volleyball']);
    assert.equal(saved.payload.p_expected_revision, 1);
    await page.screenshot({ path: path.join(output, `participants-${theme}.png`), fullPage: true });
    const adminAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    report.accessibility.push({ page: 'participants', theme, violations: adminAxe.violations });
    await page.goto(origin + '/account');
    await page.getByText('Varsity Manager', { exact: true }).waitFor();
    assert.ok(
      (await page.getByRole('img', { name: 'Brock varsity participant', exact: true }).count()) > 0,
    );
    await page.goto(origin + '/lineup-multisport/' + leagueId);
    await page
      .getByText(
        'Varsity format · any two hockey, two basketball and two volleyball athletes, plus FLEX',
        { exact: true },
      )
      .waitFor();
    await page.getByText('🏒 Hockey 1 · any position · 1/1', { exact: true }).waitFor();
    report.checks.push(
      `Participation ${theme}: admin correction payload, account badge, varsity lineup labels`,
    );
    await page.goto(origin + '/auth?next=' + encodeURIComponent('/leagues/join?code=AB12CD34'));
    assert.ok(
      (await context.cookies()).some(
        (cookie) =>
          cookie.name === 'bf_auth_next' &&
          decodeURIComponent(cookie.value) === '/leagues/join?code=AB12CD34',
      ),
      'Owned auth entry preserves a validated invitation in an HttpOnly cookie',
    );
    await page.goto(origin + '/leagues/join?code=AB12CD34');
    const invite = page.getByRole('textbox', { name: 'League invite code', exact: true });
    await invite.waitFor();
    assert.equal(await invite.inputValue(), 'AB12CD34');
    assert.ok(
      !commands.some((command) => command.name === 'join_league'),
      'Invitation does not automatically enroll',
    );
    await page
      .getByRole('textbox', { name: 'Fantasy team name', exact: true })
      .fill('Invited Badgers');
    await page.getByRole('button', { name: 'Join league', exact: true }).click();
    await page.waitForURL('**/league/' + leagueId);
    assert.equal(
      commands.find((command) => command.name === 'join_league').payload.p_invite_code,
      'AB12CD34',
    );
    report.checks.push(
      `Invitations ${theme}: auth handoff cookie, code prefill and explicit membership confirmation`,
    );
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  assert.ok(
    report.accessibility.every((entry) => entry.violations.length === 0),
    JSON.stringify(report.accessibility),
  );
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      checks: report.checks,
      screenshots: report.screenshots,
      errors: report.errors,
      accessibilityViolations: report.accessibility.reduce(
        (sum, entry) => sum + entry.violations.length,
        0,
      ),
    }),
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error(await lastPage.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
