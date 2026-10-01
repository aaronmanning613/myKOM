import { expect, test, type Page } from '@playwright/test';
import type { Results } from '@mykom/shared';
import { signIn } from './sign-in';

const CENTRE = { lat: 45.42, lng: -75.69 };
// About 3 km north of the centre: outside a 2 km Search Area, inside 5 km.
const THREE_KM_NORTH = { lat: CENTRE.lat + 0.027, lng: CENTRE.lng };

/**
 * A Runner with a generated Fitness Profile (VDOT ≈ 71.1, so about 2:41 for a flat 1 km), a
 * 2 km Search Area and Known Segments stored as if their details had been read.
 */
async function seedArea(page: Page) {
  await signIn(page, 'Rita');
  const runs = await page.request.post('/api/test/runs', {
    data: {
      runs: [
        { name: 'Marathon', distance: 42_195, movingTime: 8463, daysAgo: 300 },
        { name: '10K race', distance: 10_000, movingTime: 1839, daysAgo: 100 },
      ],
    },
  });
  expect(runs.ok()).toBe(true);
  const search = await page.request.post('/api/search', {
    data: { label: 'Ottawa, Ontario', ...CENTRE, radiusKm: 2 },
  });
  expect(search.ok()).toBe(true);
  const base = { ...CENTRE, distance: 1000, averageGrade: 0.5 };
  const segments = await page.request.post('/api/test/segments', {
    data: {
      segments: [
        { ...base, name: 'Canal Dash', athleteCount: 5400, record: 170, pb: 175 },
        {
          ...base,
          name: 'Rideau Hill',
          distance: 800,
          athleteCount: 900,
          record: 140,
          pb: 130,
          recordAgeDays: 40,
        },
        { ...base, name: 'Glitch Straight', athleteCount: 2000, record: 90, pb: null },
        { ...base, name: 'Fast Friend', athleteCount: 300, record: 150, pb: 200 },
        { ...base, ...THREE_KM_NORTH, name: 'Far Loop', athleteCount: 100, record: 175 },
      ],
    },
  });
  expect(segments.ok()).toBe(true);
}

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('ranks a seeded area and re-runs the search from the radius dropdown', async ({
      page,
    }) => {
      await seedArea(page);
      await page.goto('/results');

      await expect(page.getByText('2 of 4 Known Segments are Achievable.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Ottawa, Ontario' })).toHaveAttribute(
        'href',
        '/search-area',
      );
      const targets = page.getByRole('region', { name: /^Your targets/ });
      await expect(targets.getByRole('heading')).toHaveText('Your targets (2)');
      const rows = targets.getByRole('row');
      await expect(rows.nth(1)).toContainText('Canal Dash');
      await expect(rows.nth(1)).toContainText('1.00 km · 0.5% · 0.0 km away');
      await expect(rows.nth(1)).toContainText('5,400');
      await expect(rows.nth(2)).toContainText('Rideau Hill');
      await expect(rows.nth(2).getByRole('img', { name: 'Held' })).toBeVisible();
      await expect(rows.nth(2)).toContainText('record checked 5 weeks ago');
      const stored = (await (await page.request.get('/api/results')).json()) as Results;
      const canalDash = stored.targets.find((r) => r.name === 'Canal Dash')!;
      const link = rows.nth(1).getByRole('link', { name: 'View Canal Dash on Strava' });
      await expect(link).toHaveText('View on Strava');
      await expect(link).toHaveAttribute(
        'href',
        `https://www.strava.com/segments/${canalDash.segmentId}`,
      );
      await expect(link).toHaveAttribute('target', '_blank');
      // The link line keeps the phone layout inside the viewport.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);

      const misses = page.getByRole('region', { name: /^Nearest misses/ });
      await expect(misses.getByRole('heading')).toHaveText('Nearest misses (1)');
      await expect(misses.getByRole('row', { name: /Fast Friend/ })).toBeVisible();

      const suspicious = page.getByRole('region', { name: /^Suspicious records/ });
      const glitch = suspicious.getByRole('row', { name: /Glitch Straight/ });
      await expect(glitch).toContainText('⚠ Suspicious');
      await expect(glitch.getByRole('cell').last()).toHaveText('—');

      await page.getByRole('combobox', { name: 'Radius' }).selectOption('5');
      await expect(page.getByText('3 of 5 Known Segments are Achievable.')).toBeVisible();
      await expect(targets.getByRole('row', { name: /Far Loop/ })).toBeVisible();

      await page.reload();
      await expect(page.getByRole('combobox', { name: 'Radius' })).toHaveValue('5');
      await expect(targets.getByRole('heading')).toHaveText('Your targets (3)');
    });
  });
}

test('without a Search Area, links to the Search Area page', async ({ page }) => {
  await signIn(page, 'Nia');
  await page.goto('/results');

  await page.getByRole('link', { name: 'Choose where to look' }).click();
  await expect(page).toHaveURL(/\/search-area$/);
});

test('with fewer than two Benchmarks, prompts for the Fitness Profile', async ({ page }) => {
  await signIn(page, 'Ben');
  const search = await page.request.post('/api/search', {
    data: { label: 'Ottawa, Ontario', ...CENTRE, radiusKm: 1 },
  });
  expect(search.ok()).toBe(true);
  await page.goto('/results');

  await expect(page.getByText('0 of 0 Known Segments are Achievable.')).toBeVisible();
  await expect(page.getByText(/No targets within 1 km yet/)).toBeVisible();
  await page.getByRole('link', { name: 'Add them on your Fitness Profile' }).click();
  await expect(page).toHaveURL(/\/fitness-profile$/);
});
