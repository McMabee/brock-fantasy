/* global document, innerWidth, innerHeight, getComputedStyle */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// - Exercise exported interfaces with isolated responses and no hosted reads or writes
const output = path.resolve('test-results/privacy-accessibility');
await mkdir(output, { recursive: true });
const user = '11111111-1111-4111-8111-111111111111';
const league = '22222222-2222-4222-8222-222222222222';
const first = '33333333-3333-4333-8333-333333333333';
const second = '44444444-4444-4444-8444-444444444444';
const mime = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};
let authenticated = false;
let contactFailure = false;
let contactQueued = false;
let preferenceVersion = 0;
let preferences = [];
let leagueCreationOpen = true;
const creationPool = '55555555-5555-4555-8555-555555555555';
const calls = [];
const setup = () => ({
  mode: 'scheduled_auto',
  status: 'armed',
  blockReason: null,
  scheduledFor: new Date(Date.now() + 3600000).toISOString(),
  leagueVersion: 1,
  serverTime: new Date().toISOString(),
  automaticEnabled: true,
  myTeamId: user,
  preferenceVersion,
  preferences,
  editable: true,
  teams: [{ id: user, name: 'Your team', prepared: preferences.length > 0 }],
  players: [
    {
      id: first,
      displayName: 'Jordan Forward',
      positions: ['F'],
      program: 'Hockey',
      rank: 1,
      bio: {},
      eligibleForMe: true,
    },
    {
      id: second,
      displayName: 'Taylor Defender',
      positions: ['D'],
      program: 'Hockey',
      rank: 2,
      bio: {},
      eligibleForMe: true,
    },
  ],
});
function serve(root, app) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      const json = (body, status = 200) => {
        response.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify(body));
      };
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        if (
          url.pathname === '/api/data/supabase' &&
          url.searchParams.get('path')?.includes('/rpc/get_league_creation_context')
        )
          return json({
            available: true,
            poolId: creationPool,
            seasonLabel: '2027-28',
            windows: Object.fromEntries(
              [4, 6, 8, 10].map((size) => [
                String(size),
                {
                  open: leagueCreationOpen,
                  deadline: '2027-01-23T19:00:00Z',
                  firstScoringPeriodId: first,
                },
              ]),
            ),
          });
        if (url.pathname === '/api/command/create_beta_league') {
          calls.push({ path: url.pathname, body });
          return json({ error: 'Controlled creation retry', code: 'service_unavailable' }, 503);
        }
        if (url.pathname === '/api/auth/session')
          return json({
            user: authenticated ? { id: user, email: 'manager@example.test' } : null,
            expiresAt: Date.now() + 3600000,
          });
        if (url.pathname === '/api/contact') {
          if (request.method === 'GET') return json({ status: 'accepted' });
          calls.push({ path: url.pathname, body });
          return contactFailure
            ? json({ error: 'Temporary delivery failure; your input is retained' }, 503)
            : json(
                { requestId: body.requestId, status: contactQueued ? 'queued' : 'accepted' },
                contactQueued ? 202 : 200,
              );
        }
        if (url.pathname.endsWith('/get_league_draft_setup')) return json(setup());
        if (url.pathname.endsWith('/save_draft_preferences')) {
          calls.push({ path: url.pathname, body });
          if (body.p_expected_version !== preferenceVersion)
            return json({ error: 'Preferences changed; reload before saving', code: 'PT409' }, 409);
          preferences = body.p_athlete_ids;
          preferenceVersion++;
          return json({ version: preferenceVersion, count: preferences.length });
        }
        if (url.pathname.endsWith('/get_notification_snapshot'))
          return json({ notifications: [], unread: 0, revision: 'fixture' });
        return json(url.pathname.includes('/data/') ? [] : {});
      }
      let resource = decodeURIComponent(url.pathname);
      if (app && !path.extname(resource))
        resource = resource.startsWith('/draft-preferences/')
          ? '/draft-preferences/[leagueId].html'
          : resource === '/'
            ? '/index.html'
            : resource + '.html';
      if (!app && resource === '/') resource = '/index.html';
      const base =
        app && resource.endsWith('.html') && !resource.startsWith('/policies/')
          ? path.resolve('apps/client/dist/server')
          : root;
      const file = path.resolve(base, '.' + resource);
      if (!file.startsWith(base + path.sep)) throw Error('Invalid path');
      const content = await readFile(file);
      response.writeHead(200, {
        'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
}
const servers = [
  serve(path.resolve('apps/client/dist/client'), true),
  serve(path.resolve('../brock-fantasy-association/dist'), false),
];
for (const server of servers)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
let checks = 0;
try {
  for (const [index, site] of (process.argv.includes('--flows-only')
    ? []
    : ['app', 'association']
  ).entries())
    for (const width of [390, 1440]) {
      const origin = `http://127.0.0.1:${servers[index].address().port}`;
      const context = await browser.newContext({
        viewport: { width, height: 950 },
        colorScheme: width === 390 ? 'dark' : 'light',
      });
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
          external.push(url.origin);
          return route.abort();
        }
        return route.continue();
      });
      await context.addCookies([{ name: 'bf_access', value: 'local-fixture', url: origin }]);
      await page.goto(origin + (index === 0 ? '/privacy' : '/'));
      const banner = page.getByRole('region', { name: 'Cookie choices' });
      try {
        await banner.waitFor({ state: 'visible', timeout: 10000 });
      } catch (error) {
        console.log(
          JSON.stringify({
            site,
            width,
            errors,
            external,
            state: await page.evaluate(() => ({
              banners: [...document.querySelectorAll('[data-bf-cookie-banner]')].map(
                (node) => node.outerHTML,
              ),
              text: document.body.innerText.slice(0, 1800),
              scripts: [...document.scripts].map((script) => script.src),
            })),
          }),
        );
        throw error;
      }
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await banner.evaluate((node) => node.getBoundingClientRect().top < innerHeight),
        true,
        'choices are visible on the initial viewport',
      );
      assert.equal(
        (await context.cookies()).some((item) => item.name === 'bf_theme'),
        false,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        true,
      );
      const padding = await banner.evaluate((node) => getComputedStyle(node).paddingLeft);
      assert.equal(padding, index === 0 ? '18px' : width === 390 ? '24px' : '40px');
      await page.screenshot({
        path: path.join(output, `${site}-${width}-banner.png`),
        fullPage: true,
      });
      await banner.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${site}-${width}-consent-viewport.png`) });
      await banner.getByRole('button', { name: 'Necessary only', exact: true }).click();
      assert.equal(
        (await context.cookies()).find((item) => item.name === 'bf_consent')?.value,
        'v1.necessary',
      );
      assert.equal(
        (await context.cookies()).some((item) => item.name === 'bf_access'),
        true,
      );
      await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      assert.equal(
        await page
          .getByRole('button', { name: 'Cookie settings', exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
      await dialog.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Save preferences', exact: true }).click();
      assert.equal(
        (await context.cookies()).find((item) => item.name === 'bf_consent')?.value,
        'v1.preferences',
      );
      if (index === 0) {
        await page.getByRole('button', { name: /Switch to .* mode/ }).click();
        assert.equal(
          (await context.cookies()).some((item) => item.name === 'bf_theme'),
          true,
        );
      }
      await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
      await dialog.getByRole('button', { name: 'Necessary only', exact: true }).click();
      assert.equal(
        (await context.cookies()).some((item) => item.name === 'bf_theme'),
        false,
      );
      const audit = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      assert.deepEqual(
        audit.violations.map((item) => ({
          id: item.id,
          targets: item.nodes.map((node) => node.target),
        })),
        [],
        `${site} accessibility at ${width}`,
      );
      assert.deepEqual(errors, [], `${site} browser errors`);
      assert.deepEqual(external, [], `${site} external requests`);
      checks += 10;
      await context.close();
    }
  const appOrigin = `http://127.0.0.1:${servers[0].address().port}`;
  const flowContext = await browser.newContext({ viewport: { width: 390, height: 950 } });
  const page = await flowContext.newPage();
  await page.goto(appOrigin + '/feedback?submitted=1');
  assert.equal(
    await page.getByText('Request accepted', { exact: true }).count(),
    0,
    'URL parameters cannot forge a success state',
  );
  await page.getByLabel('Title Required').fill('A controlled delivery test');
  await page
    .getByLabel('What went wrong? Required')
    .fill('This fixture checks input preservation when delivery fails');
  contactFailure = true;
  await page.getByRole('button', { name: 'Send bug', exact: true }).click();
  await page.getByText(/Temporary delivery failure/).waitFor();
  assert.equal(await page.getByLabel('Title Required').inputValue(), 'A controlled delivery test');
  contactFailure = false;
  contactQueued = true;
  await page.getByRole('button', { name: 'Send bug', exact: true }).click();
  await page.getByText(/Your request is queued/).waitFor();
  const contactCalls = calls.filter((item) => item.path === '/api/contact');
  assert.equal(contactCalls.at(-1).body.requestId, contactCalls.at(-2).body.requestId);
  await page.getByText('Request accepted', { exact: true }).waitFor();
  authenticated = true;
  await page.goto(appOrigin + '/draft-preferences/' + league);
  await page
    .getByRole('button', { name: 'Add Jordan Forward to preferences', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Add Taylor Defender to preferences', exact: true })
    .click();
  await page.getByRole('button', { name: 'Move Taylor Defender up', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByText('1. Taylor Defender', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save private rankings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByText(/Private rankings saved/).waitFor();
  assert.deepEqual(preferences, [second, first]);
  await page.getByRole('button', { name: 'Move Taylor Defender down', exact: true }).click();
  preferenceVersion++;
  const saves = calls.filter((item) => item.path.endsWith('/save_draft_preferences')).length;
  await page.getByRole('button', { name: 'Save private rankings', exact: true }).click();
  await page.getByText(/Another save changed your list/).waitFor();
  assert.equal(
    calls.filter((item) => item.path.endsWith('/save_draft_preferences')).length,
    saves + 1,
  );
  await page.getByText('1. Jordan Forward', { exact: true }).waitFor();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  assert.deepEqual(
    audit.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
    [],
  );
  await page.screenshot({
    path: path.join(output, 'app-390-preferences-conflict.png'),
    fullPage: true,
  });
  checks += 9;
  await page.goto(appOrigin + '/leagues/new');
  try {
    await page.getByText(/2027-28 includes Brock/).waitFor({ timeout: 10000 });
  } catch (error) {
    console.error(await page.locator('body').innerText());
    throw error;
  }
  await page.getByLabel('League name', { exact: true }).fill('Late entry fixture');
  await page.getByLabel('Your fantasy team name', { exact: true }).fill('Fixture manager');
  const create = page.getByRole('button', { name: 'Create private league', exact: true });
  await create.click();
  await page.getByText('Controlled creation retry', { exact: true }).waitFor();
  await create.click();
  await page.getByText('Controlled creation retry', { exact: true }).waitFor();
  const creations = calls.filter((item) => item.path.endsWith('/create_beta_league'));
  assert.equal(creations.length, 2);
  assert.equal(creations[0].body.p_pool_id, creationPool);
  assert.equal(creations[0].body.p_idempotency_key, creations[1].body.p_idempotency_key);
  leagueCreationOpen = false;
  await page.reload();
  await page.getByText(/no eligible regular-season period remaining/).waitFor();
  assert.equal(await create.isDisabled(), true);
  assert.equal(calls.filter((item) => item.path.endsWith('/create_beta_league')).length, 2);
  checks += 5;
  await page.goto(appOrigin + '/rules');
  const firstTab = page.getByRole('tab', { name: 'Getting started', exact: true });
  await firstTab.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page
      .getByRole('tab', { name: 'Roster & positions', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('End');
  assert.equal(
    await page.getByRole('tab', { name: 'Stats & ADP', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.keyboard.press('Home');
  assert.equal(await firstTab.getAttribute('aria-selected'), 'true');
  const help = page.getByRole('button', { name: 'Help and support', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Close help options', exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Help and support', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await help.evaluate((node) => node === document.activeElement), true);
  const rulesAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  assert.deepEqual(
    rulesAudit.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
    [],
  );
  checks += 5;
  console.log(
    `PASS ${checks} cookie, keyboard, spacing, privacy, contact and preference assertions with accessibility scans`,
  );
} finally {
  await browser.close();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
