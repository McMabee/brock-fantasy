import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

interface AuditedPage {
  name: string;
  open: (page: Page) => Promise<unknown>;
}

const route = (name: string, path: string): AuditedPage => ({
  name,
  open: (page) => page.goto(path),
});

const routes: readonly AuditedPage[] = [
  route('home', '/'),
  route('authentication', '/auth'),
  route('dashboard', '/dashboard'),
  {
    name: 'league',
    open: async (page) => {
      await page.goto('/dashboard');
      await page.getByRole('link', { name: 'Open', exact: true }).click();
    },
  },
  {
    name: 'draft',
    open: async (page) => {
      await page.goto('/dashboard');
      await page.getByRole('link', { name: 'Open draft room' }).click();
    },
  },
  route('league setup', '/leagues/new'),
  route('account', '/account'),
  route('notifications', '/notifications'),
  route('ingestion incident control', '/admin/incidents'),
  route('provider mapping review', '/admin/mappings'),
  route('score replay preview', '/admin/replay'),
];

for (const auditedPage of routes) {
  const { name } = auditedPage;
  test(`${name} has no automated WCAG A/AA violations`, async ({ page }) => {
    await auditedPage.open(page);
    await expect(page.getByRole('link', { name: 'Brock Fantasy home' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const summary = results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} node${violation.nodes.length === 1 ? '' : 's'})`,
      )
      .join('\n');

    expect(results.violations, summary).toEqual([]);
  });
}
