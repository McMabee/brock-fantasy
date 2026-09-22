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
