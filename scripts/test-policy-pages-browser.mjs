/* global document, window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const sites = [
  { id: 'app', root: path.resolve('apps/client/public') },
  { id: 'association', root: path.resolve('../brock-fantasy-association/public') },
];
const output = path.resolve('dev/tmp/ui-policy-refresh');
await mkdir(output, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ttf': 'font/ttf',
};
async function serveSite(site) {
  const root = site.root;
  const server = createServer(async (request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.setHeader('content-type', mime[path.extname(file)] ?? 'application/octet-stream');
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { ...site, server, origin };
}
const deployments = await Promise.all(sites.map(serveSite));
const browser = await chromium.launch({ headless: true });
const report = { checks: [], errors: [], violations: [] };
try {
  for (const site of deployments) {
    const { root, origin } = site;
    const files = (await readdir(path.join(root, 'policies')))
      .filter((name) => name.endsWith('.html'))
      .sort();
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ colorScheme: theme });
      await context.addCookies([
        { name: 'bf_consent', value: 'v1.preferences', url: origin },
        { name: 'bf_theme', value: theme, url: origin },
      ]);
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(error.message));
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
        for (const file of files) {
          await page.goto(`${origin}/policies/${file}`);
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.locator('h1').count(), 1);
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          assert.equal(await page.locator('body').getAttribute('data-policy-site'), site.id);
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
            `${file} fits ${width}`,
          );
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          if (axe.violations.length)
            report.violations.push({ file, theme, width, violations: axe.violations });
          await page.screenshot({
            path: path.join(
              output,
              `${site.id}-${file.replace('.html', '')}-${theme}-${width}.png`,
            ),
            fullPage: true,
          });
          if (['privacy-notice.html', 'data-minimization.html'].includes(file))
            await page.screenshot({
              path: path.join(
                output,
                `${site.id}-${file.replace('.html', '')}-${theme}-${width}-viewport.png`,
              ),
            });
          report.checks.push({ site: site.id, file, theme, width });
        }
      }
      await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      assert.ok(
        await page
          .getByRole('button', { name: 'Cookie settings', exact: true })
          .evaluate((element) => document.activeElement === element),
      );
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.violations, []);
  console.log(
    `${report.checks.length} policy layouts passed with no accessibility violations or browser errors`,
  );
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await Promise.all(
    deployments.map(({ server }) => new Promise((resolve) => server.close(resolve))),
  );
}
