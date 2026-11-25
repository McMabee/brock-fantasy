import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import handler from '../api/index.js';

// - Exercise exported login markup and cookie controls without real accounts or hosted requests
process.env.EXPO_PUBLIC_APP_ENV = 'local';
process.env.EXPO_PUBLIC_APP_ORIGIN = 'http://localhost:8081';
const root = path.resolve('apps/client/dist/client');
const output = 'test-results/auth-layout';
await mkdir(output, { recursive: true });
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://local');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    const type = mime[path.extname(file)];
    if (file.startsWith(root + path.sep) && type) {
      response.setHeader('content-type', type);
      response.end(await readFile(file));
    } else await handler(request, response);
  } catch {
    response.writeHead(500);
    response.end('Login fixture unavailable');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = { hosted: false, checks: [], screenshots: [], errors: [] };
try {
  for (const theme of ['dark', 'light'])
    for (const width of [320, 390, 829, 1440]) {
      const name = `${theme}-${width}`;
      const context = await browser.newContext({
        viewport: { width, height: width === 829 ? 1803 : 1000 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      await context.addCookies([
        { name: 'bf_theme', value: theme, url: origin },
        { name: 'bf_consent', value: 'v1.preferences', url: origin },
      ]);
      await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        report.errors.push(`${name}: unexpected external request`);
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(`${name}: ${error.message}`));
      await page.goto(origin + '/auth');
      await page.evaluate(() => globalThis.document.fonts.ready);
      const links = page.getByRole('navigation', { name: 'Account help' });
      const cookie = links.getByRole('button', { name: 'Cookie settings', exact: true });
      await expect(cookie).toHaveCount(1);
      const typography = (element) => {
        const style = globalThis.getComputedStyle(element);
        return [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.color];
      };
      assert.deepEqual(
        await cookie.evaluate(typography),
        await links.getByRole('link').first().evaluate(typography),
        `${name}: account help typography matches`,
      );
      assert.ok(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1,
        ),
        `${name}: no horizontal overflow`,
      );
      if (width > 850) {
        const headline = await page.locator('.auth-intro h2').boundingBox();
        const copy = await page.locator('.auth-intro > p').last().boundingBox();
        const sports = await page.locator('.auth-sports').boundingBox();
        const form = await page.locator('main').boundingBox();
        assert.ok(
          Math.abs(copy.y - headline.y - headline.height - 24) < 2,
          `${name}: intro copy spacing`,
        );
        assert.ok(Math.abs(sports.y - copy.y - copy.height - 24) < 2, `${name}: sports spacing`);
        assert.ok(copy.x + copy.width < form.x, `${name}: copy stays beside the form`);
      }
      await cookie.click();
      await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(cookie).toBeFocused();
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      assert.deepEqual(accessibility.violations, [], `${name}: login accessibility`);
      const screenshot = `${output}/${name}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      report.screenshots.push(screenshot);
      await context.clearCookies();
      await page.reload();
      await expect(page.getByRole('region', { name: 'Cookie choices' })).toBeVisible();
      await expect(links.getByRole('button', { name: 'Cookie settings', exact: true })).toHaveCount(
        1,
      );
      report.checks.push(
        `${name}: responsive login, matching help links, cookie dialog and first visit`,
      );
      await context.close();
    }
  assert.deepEqual(report.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(`Login layout checks passed in ${report.checks.length} theme/viewport combinations`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
