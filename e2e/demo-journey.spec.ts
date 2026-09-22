import { expect, test } from '@playwright/test';

test('opens the demo dashboard and league', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Brock sports/ })).toBeVisible();
  await page.getByRole('link', { name: 'Explore demo' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Game day starts here.' })).toBeVisible();

  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/league\/demo-league$/);
  await expect(page.getByRole('heading', { name: 'Badger Ice League' })).toBeVisible();
  const standingsTab = page.getByRole('tab', { name: /standings/i });
  await standingsTab.click();
  await expect(standingsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'League standings' })).toBeVisible();
});

test('creates a configured demo league', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Create league' }).click();

  await page.getByLabel('League name').fill('Accessibility Test League');
  await page.getByRole('radio', { name: "Women's Hockey" }).click();
  await page.getByRole('radio', { name: /Points leaderboard/ }).click();
  await page.getByRole('button', { name: 'Create private league' }).click();

  await expect(page).toHaveURL(/\/league\/demo-league$/);
  await expect(page.getByRole('heading', { name: 'Badger Ice League' })).toBeVisible();
});

test('drafts and queues athletes in the demo room', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Open draft room' }).click();

  await expect(page.getByRole('heading', { name: 'Badger Ice League Draft' })).toBeVisible();
  const draftButtons = page.getByRole('button', { name: /^Draft / });
  const initialCount = await draftButtons.count();
  expect(initialCount).toBeGreaterThan(0);

  const firstDraftLabel = await draftButtons.first().getAttribute('aria-label');
  await draftButtons.first().click();
  await expect(page.getByRole('button', { name: firstDraftLabel ?? '' })).toHaveCount(0);

  const queueButton = page.getByRole('button', { name: /^Add .* to queue$/ }).first();
  const queueLabel = await queueButton.getAttribute('aria-label');
  await queueButton.click();
  await expect(
    page.getByRole('button', {
      name: queueLabel?.replace(/^Add /, 'Remove ').replace(' to ', ' from ') ?? '',
    }),
  ).toBeVisible();
});

test('persists the selected colour theme', async ({ page }) => {
  await page.goto('/');

  const lightSwitch = page.getByRole('button', { name: 'Switch to light theme' });
  await expect(lightSwitch).toBeVisible();
  await lightSwitch.click();
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
});

test('pauses and resumes one competition ingestion feed', async ({ page }) => {
  await page.goto('/admin/incidents');

  await page
    .getByLabel("Men's Hockey incident reason", { exact: true })
    .fill('Provider response is delayed');
  await page.getByRole('button', { name: 'Pause ingestion' }).first().click();
  await expect(page.getByRole('alert')).toHaveText("Men's Hockey ingestion paused.");
  await expect(page.getByText('ACTIVE INCIDENT')).toBeVisible();

  await page
    .getByLabel("Men's Hockey resolution reason", { exact: true })
    .fill('Provider feed is reconciled');
  await page.getByRole('button', { name: 'Resume ingestion' }).click();
  await expect(page.getByRole('alert')).toHaveText("Men's Hockey ingestion resumed.");
  await expect(page.getByText('ACTIVE INCIDENT')).toHaveCount(0);
});

test('reviews a provider mapping and resolves its ingestion error', async ({ page }) => {
  await page.goto('/admin/mappings');

  await page
    .getByLabel('approved-provider athlete player-19842 review reason', { exact: true })
    .fill('Matched against the approved roster');
  await page.getByRole('button', { name: 'Verify mapping' }).click();
  await expect(page.getByRole('alert')).toHaveText('Mapping verified for review.');

  await page
    .getByLabel('UNMAPPED_ATHLETE demo-error-1 resolution reason', { exact: true })
    .fill('Verified athlete mapping is available');
  await page.getByRole('button', { name: 'Mark resolved' }).first().click();
  await expect(page.getByRole('alert')).toHaveText('UNMAPPED_ATHLETE marked resolved.');
  await expect(page.getByText('UNMAPPED_ATHLETE', { exact: true })).toHaveCount(0);
});
