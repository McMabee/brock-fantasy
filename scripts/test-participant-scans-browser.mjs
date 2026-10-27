import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Share synthetic server state between two independently authenticated browser contexts
const root = path.resolve('apps/client/dist/client');
const output = path.resolve('dev/tmp/participant-scans-browser');
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(new URL(request.url, 'http://local').pathname),
    );
    const types = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ttf': 'font/ttf',
      '.woff2': 'font/woff2',
    };
    if (file.startsWith(root + path.sep) && types[path.extname(file)]) {
      response.writeHead(200, { 'content-type': types[path.extname(file)] });
      response.end(await readFile(file));
      return;
    }
    await handler(request, response);
  } catch {
    response.writeHead(500);
    response.end('Fixture server failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = { hosted: false, checks: [], screenshots: [], accessibility: [], errors: [] };
try {
  for (const theme of ['dark', 'light']) {
    const account = {
      id: 'candidate',
      display_name: 'Jordan Smith',
      email: 'jordan@example.test',
      role: 'none',
      programs: [],
      revision: 1,
    };
    const existing = {
      id: 'existing',
      display_name: 'Existing Coach',
      email: 'existing@example.test',
      role: 'coach',
      programs: ['mens_hockey'],
      revision: 1,
    };
    const reference = {
      name: 'Jordan Smyth',
      emails: ['jordan@example.test'],
      role: 'coach',
      programs: ['mens_hockey', 'womens_hockey'],
      sources: [
        { file: 'Synthetic staff reference', rowNumber: 2, title: 'Coach', supportingStaff: false },
      ],
    };
    const firstRun = {
      id: 'run-1',
      reference_version_id: 'version-1',
      scoring_version: 'participant-match-v1',
      started_at: '2026-10-27T14:00:00Z',
      completed_at: '2026-10-27T14:00:01Z',
      runner_name: 'First Admin',
      account_count: 2,
      result_count: 1,
    };
    const history = [firstRun];
    let dismissed = false,
      reviewId = null,
      reviewReason = null,
      reviewer = null,
      evidenceChanged = false,
      saveConflict = false;
    const commands = [];
    const snapshot = (id) => ({
      enabled: true,
      activeReferenceVersionId: 'version-1',
      run: history.find((x) => x.id === id) ?? history[0],
      history,
      newRegistrations: 1,
      matches: [
        {
          id: 'match-1',
          user_id: account.id,
          reference_id: 'ref-1',
          score: 100,
          display_name: account.display_name,
          email: account.email,
          resolved: account.role !== 'none',
          dismissed,
          review_id: reviewId,
          review_reason: reviewReason,
          reviewer_name: reviewer,
          reviewed_at: '2026-10-27T14:05:00Z',
          evidence_changed: evidenceChanged,
          evidence: {
            reference,
            accountName: account.display_name,
            accountEmail: account.email,
            reasons: ['Exact supplied email'],
            scores: { email: 100 },
          },
        },
        {
          id: 'match-2',
          user_id: account.id,
          reference_id: 'ref-2',
          score: 60,
          display_name: account.display_name,
          email: account.email,
          resolved: account.role !== 'none',
          dismissed: false,
          review_id: null,
          review_reason: null,
          reviewer_name: null,
          reviewed_at: null,
          evidence_changed: evidenceChanged,
          evidence: {
            reference: {
              ...reference,
              name: 'Different Possible Person',
              programs: ['mens_basketball'],
            },
            accountName: account.display_name,
            accountEmail: account.email,
            reasons: ['Inferred email username'],
            scores: { inferredUsername: 60 },
          },
        },
      ],
    });
    const contexts = [];
    for (const admin of ['First Admin', 'Second Admin']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      contexts.push(context);
      await context.addCookies([
        { name: 'bf_theme', value: theme, url: origin },
        { name: 'bf_consent', value: 'v1.preferences', url: origin },
        { name: 'bf_csrf', value: 'fixture', url: origin },
      ]);
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        const reply = (body, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/session')
          return reply({
            user: { id: admin, email: 'admin@example.test' },
            expiresAt: Date.now() + 3600000,
          });
        if (url.pathname === '/api/admin/status')
          return reply({ authenticated: true, hasAdminRole: true, isAdmin: true, aal: 'aal2' });
        if (url.pathname === '/api/auth/csrf') return reply({});
        if (url.pathname.startsWith('/api/command/')) {
          const name = url.pathname.split('/').at(-1),
            payload = route.request().postDataJSON();
          commands.push({ name, payload });
          if (name === 'admin_run_participant_scan') {
            history.unshift({
              ...firstRun,
              id: `run-${history.length + 1}`,
              runner_name: admin,
              completed_at: '2026-10-27T15:00:01Z',
            });
            return reply({ scanId: history[0].id });
          }
          if (name === 'admin_review_participant_match') {
            dismissed = payload.p_dismissed;
            reviewReason = payload.p_reason;
            reviewer = admin;
            reviewId = `review-${commands.length}`;
            return reply({ reviewId });
          }
          if (name === 'admin_set_participation') {
            if (saveConflict) {
              saveConflict = false;
              account.revision++;
              return reply(
                { error: 'Participation changed; reload and retry', code: 'PT409' },
                409,
              );
            }
            Object.assign(account, {
              role: payload.p_role,
              programs: payload.p_programs,
              revision: account.revision + 1,
            });
            return reply({ revision: account.revision });
          }
        }
        const name = (url.searchParams.get('path') ?? '').split('?')[0].split('/').at(-1);
        if (name === 'admin_list_varsity_participants')
          return reply([existing, ...(account.role !== 'none' ? [account] : [])]);
        if (name === 'admin_get_participant_scan')
          return reply(snapshot(route.request().postDataJSON()?.p_scan_id));
        if (name === 'admin_get_participant')
          return reply(
            route.request().postDataJSON()?.p_user_id === existing.id ? existing : account,
          );
        if (name === 'admin_find_participants') return reply([account]);
        if (name === 'get_notification_snapshot') return reply({ items: [], unreadCount: 0 });
        return reply([]);
      });
    }
    const page = await contexts[0].newPage(),
      other = await contexts[1].newPage();
    await page.clock.install();
    page.on('pageerror', (error) => report.errors.push(error.message));
    other.on('pageerror', (error) => report.errors.push(error.message));
    await Promise.all([
      page.goto(origin + '/admin/participants'),
      other.goto(origin + '/admin/participants'),
    ]);
    await expect(page.getByText('Jordan Smith · 100/100', { exact: true })).toBeVisible();
    await expect(page.getByText('Inferred email username', { exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Minimum match score', exact: true }).fill('35');
    await page.getByRole('button', { name: 'Show 1 alternative matches', exact: true }).click();
    await expect(page.getByText('Inferred email username', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Select Jordan Smith matching Jordan Smyth', exact: true })
      .click();
    await expect(page.getByRole('radio', { name: 'Varsity coach', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'Varsity coach', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('textbox', { name: 'Reason for participation correction', exact: true }),
    ).toHaveValue('');
    assert.equal(commands.filter((x) => x.name === 'admin_set_participation').length, 0);
    await page
      .getByRole('textbox', { name: 'Reason for participation correction', exact: true })
      .fill('Reviewing the current participant');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Review Existing Coach', exact: true }).click();
    await expect(
      page.getByRole('textbox', { name: 'Reason for participation correction', exact: true }),
    ).toHaveValue('Reviewing the current participant');
    await page
      .getByRole('button', { name: 'Refresh shared participant data', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Reason for participation correction', exact: true }),
    ).toHaveValue('Reviewing the current participant');
    await other.getByRole('button', { name: 'Dismiss this match', exact: true }).click();
    await other
      .getByRole('textbox', { name: 'Reason for match review', exact: true })
      .fill('Confirmed this is another person');
    await other.getByRole('button', { name: 'Save shared review', exact: true }).click();
    await expect(
      other.getByText('No candidates match these filters.', { exact: true }),
    ).toBeVisible();
    await page.bringToFront();
    await page.clock.runFor(15100);
    await expect(page.getByText('Jordan Smith · 100/100', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('textbox', { name: 'Reason for participation correction', exact: true }),
    ).toHaveValue('Reviewing the current participant');
    await page.getByRole('checkbox', { name: 'Show dismissed', exact: true }).click();
    await page.getByRole('button', { name: 'Undo dismissal', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Reason for match review', exact: true })
      .fill('Second review confirms this identity');
    await page.getByRole('button', { name: 'Save shared review', exact: true }).click();
    await expect(page.getByText('Shared review saved.', { exact: true })).toBeVisible();
    saveConflict = true;
    await page.getByRole('button', { name: 'Save participation', exact: true }).click();
    await expect(page.getByText(/Current values have been loaded/u)).toBeVisible();
    const saveCount = commands.filter((x) => x.name === 'admin_set_participation').length;
    await page.clock.runFor(15100);
    assert.equal(commands.filter((x) => x.name === 'admin_set_participation').length, saveCount);
    await page
      .getByRole('button', { name: 'Select Jordan Smith matching Jordan Smyth', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Reason for participation correction', exact: true })
      .fill('Verified both program affiliations');
    await page.getByRole('button', { name: 'Save participation', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Review Jordan Smith', exact: true }),
    ).toBeVisible();
    assert.deepEqual(account.programs, ['mens_hockey', 'womens_hockey']);
    await expect(
      page.getByText('No candidates match these filters.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('checkbox', { name: 'Show resolved', exact: true }).click();
    await expect(page.getByText('Resolved — already classified', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Run participant scan', exact: true }).click();
    await expect(
      page.getByText('Scan completed. Results are shared with all administrators.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Show scan history', exact: true }).click();
    await page
      .getByRole('button', { name: /Oct 27, 2026.*First Admin/u })
      .last()
      .click();
    await page.clock.runFor(15100);
    await expect(page.getByText('Reference version: version-1', { exact: true })).toBeVisible();
    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width < 1280) {
        await page.getByRole('tab', { name: 'Participants', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Review Jordan Smith', exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Review Jordan Smith', exact: true }).click();
        await expect(
          page.getByRole('tab', { name: 'Search and edit', exact: true }),
        ).toHaveAttribute('aria-selected', 'true');
        await page.getByRole('tab', { name: 'Scan', exact: true }).click();
      }
      const overflow = await page
        .locator('[data-bf-page]')
        .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      assert.equal(overflow, false, `${theme} ${width}px fits the page`);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      assert.deepEqual(result.violations, [], `${theme} ${width}px accessibility`);
      const screenshot = path.join(output, `${theme}-${width}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      report.screenshots.push(screenshot);
      report.accessibility.push({ theme, width, violations: result.violations.length });
    }
    evidenceChanged = true;
    await page
      .getByRole('button', { name: 'Refresh shared participant data', exact: true })
      .click();
    await expect(
      page.getByText(
        'Account identity changed since this scan. Run a new scan before using a suggestion.',
        { exact: true },
      ),
    ).toBeVisible();
    report.checks.push(
      `${theme}: two admins, shared review and undo, 15-second polling, unsaved edits, conflict without resubmit, multi-program prefill, resolution, history, stale evidence, responsive layout`,
    );
    for (const context of contexts) await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report));
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
