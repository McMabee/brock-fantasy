/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// - Exercise exported public routes without hosted accounts, private CSVs or email sends
process.env.EXPO_PUBLIC_APP_ENV = 'local';
delete process.env.VERCEL;
const { default: handler } = await import('../api/index.js');
const staticRoot = path.resolve('apps/client/dist/client');
const feedbackEndpoint = 'https://formsubmit.co/c561de24beb750974ce891e2eb88ed52';
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://local').pathname;
    const file = path.resolve(staticRoot, '.' + decodeURIComponent(pathname));
    const type = mime[path.extname(file)];
    if (file.startsWith(staticRoot + path.sep) && type) {
      const content = await readFile(file);
      response.writeHead(200, { 'content-type': type });
      response.end(content);
      return;
    }
    await handler(request, response);
  } catch {
    response.writeHead(500);
    response.end('Local verification failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.EXPO_PUBLIC_APP_ORIGIN = origin;
const output = 'test-results/launch';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
const errors = [];
try {
  for (const [width, theme] of [
    [390, 'dark'],
    [1440, 'light'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'bf_theme', value: theme, url: origin }]);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
    await page.goto(origin);
    await page.getByRole('link', { name: 'Create an account', exact: true }).click();
    await page.waitForURL('**/auth?mode=sign-up');
    assert.equal(
      await page.locator('.auth-tabs [aria-current="page"]').innerText(),
      'Create an account',
    );
    assert.equal(await page.locator('form').getAttribute('action'), '/api/auth/sign-up');
    assert.equal(await page.getByLabel('Full name', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('radio').count(), 4);
    await page.getByRole('radio', { name: 'Yes, varsity athlete', exact: true }).check();
    assert.equal(
      await page.getByRole('checkbox', { name: "Women's Volleyball", exact: true }).isEnabled(),
      true,
    );
    await page.getByRole('checkbox', { name: "Women's Volleyball", exact: true }).check();
    await page.getByRole('radio', { name: 'No, I am neither', exact: true }).check();
    assert.equal(
      await page.getByRole('checkbox', { name: "Women's Volleyball", exact: true }).count(),
      0,
    );
    assert.ok(!/\bbeta\b/iu.test(await page.locator('body').innerText()));
    await page.screenshot({
      path: `${output}/signup-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/auth?mode=sign-in');
    assert.equal(await page.locator('.auth-tabs [aria-current="page"]').innerText(), 'Sign in');
    assert.equal(await page.locator('form').getAttribute('action'), '/api/auth/sign-in');
    assert.equal(await page.getByLabel('Full name', { exact: true }).count(), 0);
    await page.screenshot({
      path: `${output}/signin-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.goto(origin + '/signup');
    assert.equal(
      await page.locator('.auth-tabs [aria-current="page"]').innerText(),
      'Create an account',
    );
    await page.getByRole('link', { name: 'Report Bugs/Suggestions', exact: true }).click();
    await page.waitForURL('**/feedback');
    await page.getByRole('heading', { name: 'Report Bugs/Suggestions', exact: true }).waitFor();
    assert.equal(await page.locator('.feedback-form').getAttribute('method'), 'POST');
    for (const kind of ['Bug', 'Suggestion']) {
      if (kind === 'Suggestion') await page.goto(origin + '/feedback');
      assert.equal(await page.locator('.feedback-form').getAttribute('action'), feedbackEndpoint);
      assert.ok(!(await page.locator('.feedback-form').innerText()).includes('tymabee@proton.me'));
      await page.getByRole('radio', { name: kind, exact: true }).check();
      await page.getByLabel('Title', { exact: false }).fill('Fixture feedback title');
      await page
        .getByLabel(kind === 'Bug' ? 'What went wrong?' : 'What would you like us to improve?', {
          exact: false,
        })
        .fill('Disposable browser verification, never sent to an email provider');
      await page.getByLabel('Your email', { exact: false }).fill('fixture@example.test');
      if (kind === 'Bug')
        await page
          .getByLabel('Steps to reproduce', { exact: false })
          .fill('Open the fixture and select a control');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      assert.equal(overflow, false);
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      assert.deepEqual(accessibility.violations, [], `${kind} form accessibility at ${width}px`);
      await page
        .getByRole('heading', { name: 'Report Bugs/Suggestions', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${output}/${kind.toLowerCase()}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      let captured = false;
      await page.route('https://formsubmit.co/**', async (route) => {
        assert.equal(route.request().url(), feedbackEndpoint);
        assert.equal(route.request().method(), 'POST');
        const form = new URLSearchParams(route.request().postData());
        assert.equal(form.get('Report type'), kind);
        assert.equal(form.get('_subject'), `Brock Fantasy ${kind} Report`);
        assert.equal(form.get('email'), 'fixture@example.test');
        assert.equal(form.get('_captcha'), null);
        captured = true;
        await route.fulfill({
          status: 303,
          headers: { location: origin + '/feedback?submitted=1' },
        });
      });
      await page.getByRole('button', { name: `Send ${kind.toLowerCase()}`, exact: true }).click();
      await page.waitForURL('**/feedback?submitted=1');
      await page.getByRole('heading', { name: 'Thanks for your feedback', exact: true }).waitFor();
      assert.equal(captured, true);
      await page.unroute('https://formsubmit.co/**');
    }
    results.push({
      width,
      theme,
      authModesSelected: true,
      signupAlias: true,
      bugAndSuggestionPostsCaptured: true,
      feedbackAccessibilityViolations: 0,
      realEmailsSent: false,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, browserErrors: errors }, null, 2),
  );
  console.log(JSON.stringify({ results, browserErrors: errors }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
