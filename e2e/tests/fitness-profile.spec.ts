import { expect, test, type Page } from './fixtures';
import { signIn } from './sign-in';

const time = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const row = (page: Page, label: string) => page.getByRole('row').filter({ has: time(page, label) });

/** Signs in a Runner whose runs (a 2:21:03 marathon and a 30:39 10K) generate VDOT 71.1. */
async function signInWithRuns(page: Page) {
  await signIn(page, 'Gen');
  const res = await page.request.post('/api/test/runs', {
    data: {
      runs: [
        { name: 'City Marathon', distance: 42_195, movingTime: 8463, daysAgo: 300 },
        { name: 'Spring 10K', distance: 10_000, movingTime: 1839, daysAgo: 100 },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto('/fitness-profile');
  await expect(page.getByText(/^Estimated from City Marathon .* and Spring 10K/)).toBeVisible();
}

test('a Runner with no runs enters Benchmarks, which persist across a reload', async ({ page }) => {
  await signIn(page, 'Bea');
  await page.goto('/fitness-profile');
  await expect(page.getByText(/didn’t find any race-like runs/)).toBeVisible();

  await time(page, '1 mile').fill('5:75');
  await time(page, '1 mile').blur();
  await expect(page.getByText('Minutes and seconds must be under 60')).toBeVisible();

  await time(page, '1 mile').fill('6:10');
  await time(page, '1 mile').press('Enter');
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await time(page, '8K').fill('32:40');
  await time(page, '8K').blur();
  await expect(row(page, '8K')).toContainText('📌 yours');
  await expect(page.getByText('4:05/km')).toBeVisible();

  await page.reload();
  await expect(time(page, '1 mile')).toHaveValue('6:10');
  await expect(time(page, '8K')).toHaveValue('32:40');
  await expect(time(page, '400m')).toHaveValue('');

  await time(page, '1 mile').fill('');
  await time(page, '1 mile').blur();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.reload();
  await expect(time(page, '1 mile')).toHaveValue('');
  await expect(time(page, '8K')).toHaveValue('32:40');
});

test('editing pins a Benchmark, and use generated unpins it', async ({ page }) => {
  await signInWithRuns(page);
  await expect(time(page, '5K')).toHaveValue('14:43');
  await expect(time(page, '10K')).toHaveValue('30:36');
  await expect(page.getByRole('button', { name: 'Reset all to generated' })).toBeHidden();

  await time(page, '5K').fill('15:10');
  await time(page, '5K').blur();
  await expect(row(page, '5K')).toContainText('📌 yours · generated 14:43 · use generated');

  await page.reload();
  await expect(time(page, '5K')).toHaveValue('15:10');
  await expect(row(page, '5K')).toContainText('📌 yours · generated 14:43');
  // The pin survives a reload, but "Update all from this" is only for the row just edited.
  await expect(page.getByRole('button', { name: 'Update all from this' })).toBeHidden();

  await page.getByRole('button', { name: 'Use generated 5K' }).click();
  await expect(time(page, '5K')).toHaveValue('14:43');
  await expect(row(page, '5K')).not.toContainText('📌');
  await page.reload();
  await expect(time(page, '5K')).toHaveValue('14:43');
  await expect(row(page, '5K')).not.toContainText('📌');
});

test('update all from one Benchmark, then reset all to generated', async ({ page }) => {
  await signInWithRuns(page);

  await time(page, '5K').fill('16:00');
  await time(page, '5K').blur();
  await row(page, '5K').getByRole('button', { name: 'Update all from this' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'All Benchmarks updated from your 5K of 16:00.',
  );
  await expect(time(page, '10K')).toHaveValue('33:13');
  await expect(time(page, 'Half marathon')).toHaveValue('1:13:19');
  await expect(time(page, 'Marathon')).toHaveValue('2:33:26');

  await page.reload();
  await expect(time(page, 'Marathon')).toHaveValue('2:33:26');
  await expect(row(page, 'Marathon')).toContainText(/📌 yours · generated 2:21:1[5-7]/);

  await page.getByRole('button', { name: 'Reset all to generated' }).click();
  await expect(page.getByRole('status')).toHaveText('All Benchmarks reset to generated.');
  await expect(time(page, '10K')).toHaveValue('30:36');
  await expect(page.getByRole('button', { name: 'Reset all to generated' })).toBeHidden();

  await page.reload();
  await expect(time(page, '5K')).toHaveValue('14:43');
  await expect(time(page, 'Marathon')).toHaveValue(/^2:21:1[5-7]$/);
  await expect(page.getByText('📌 yours')).toHaveCount(0);
});
