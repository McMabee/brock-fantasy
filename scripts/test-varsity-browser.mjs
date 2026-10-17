/* global document, window, getComputedStyle */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
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
        return reply({ revision: participant.revision });
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
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
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
      await page.getByRole('button', { name: 'Close athlete insights', exact: true }).click();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      const listImage = `transactions-${theme}-${width}.png`;
      await page.screenshot({ path: path.join(output, listImage), fullPage: true });
      report.screenshots.push(listImage);
      report.checks.push(
        `Transactions ${theme} ${width}: filters, immediate sorting, photos, team names, program restriction, typography, centered animated statistics`,
      );
    }
    await page.getByRole('radio', { name: 'Hotel Guard · Guard / backcourt', exact: true }).click();
    await page.getByRole('button', { name: 'Add now', exact: true }).first().click();
    await page.getByText('Transaction completed.', { exact: true }).waitFor();
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
