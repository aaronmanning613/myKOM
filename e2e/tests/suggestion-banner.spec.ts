import { expect, test, type Page } from '@playwright/test';
import { signIn } from './sign-in';

const time = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const banner = (page: Page) => page.getByRole('region', { name: 'Fitness Profile suggestion' });

/**
 * Signs in a Runner whose applied profile (a 2:21:03 marathon and a 30:39 10K) is VDOT 71.1,
 * then stores a faster 5K as a new-run check would, which suggests a new profile.
 */
async function signInWithSuggestion(page: Page) {
  await signIn(page, 'Sug');
  const applied = await page.request.post('/api/test/runs', {
    data: {
      runs: [
        { name: 'City Marathon', distance: 42_195, movingTime: 8463, daysAgo: 300 },
        { name: 'Spring 10K', distance: 10_000, movingTime: 1839, daysAgo: 100 },
      ],
    },
  });
  expect(applied.ok()).toBe(true);
  const suggested = await page.request.post('/api/test/runs', {
    data: {
      runs: [{ name: 'Parkrun PB', distance: 5000, movingTime: 840, daysAgo: 2 }],
      profile: 'suggest',
    },
  });
  expect(suggested.ok()).toBe(true);
}

test('Apply in place updates the unpinned Benchmarks, and the banner stays gone', async ({
  page,
}) => {
  await signInWithSuggestion(page);
  await page.goto('/search-area');

  await expect(banner(page)).toContainText(/Your 5K on \d+ \w{3} suggests VDOT 71\.1 → 7\d\.\d/);
  await banner(page).getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByText(/^Applied: your Fitness Profile is now VDOT 7\d\.\d\.$/),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/search-area$/);

  await page.getByRole('link', { name: 'Fitness Profile' }).click();
  await expect(page.getByText(/^Estimated from Parkrun PB/)).toBeVisible();
  await expect(time(page, '5K')).not.toHaveValue('14:43');
  await expect(banner(page)).toBeHidden();
  await page.reload();
  await expect(time(page, '5K')).not.toHaveValue('14:43');
  await expect(banner(page)).toBeHidden();
});

test('Review shows the suggested values, and × dismisses for good', async ({ page }) => {
  await signInWithSuggestion(page);
  await page.goto('/results');

  await banner(page).getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(/\/fitness-profile$/);
  await expect(page.getByRole('columnheader', { name: 'Suggested' })).toBeVisible();
  await expect(time(page, '5K')).toHaveValue('14:43');

  await banner(page).getByRole('button', { name: 'Dismiss suggestion' }).click();
  await expect(banner(page)).toBeHidden();
  await expect(page.getByRole('columnheader', { name: 'Suggested' })).toBeHidden();
  await expect(time(page, '5K')).toHaveValue('14:43');

  await page.goto('/results');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(banner(page)).toBeHidden();
});
