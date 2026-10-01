import type { GeocodeResponse } from '@mykom/shared';
import { expect, test, type Page } from './fixtures';
import { signIn } from './sign-in';

const PLACE = { label: 'High Park, Toronto, Ontario', lat: 43.6465, lng: -79.4637 };

// Nominatim is stubbed in the browser, so e2e never reaches it.
const geocode: GeocodeResponse = { results: [PLACE] };

/** Race-like runs (VDOT ≈ 71.1) and a Known Segment at the place, as if Strava had given them. */
async function seedRunsAndSegments(page: Page) {
  const runs = await page.request.post('/api/test/runs', {
    data: {
      runs: [
        { name: 'Waterfront Marathon', distance: 42_195, movingTime: 8463, daysAgo: 300 },
        { name: 'Spring Run Off', distance: 10_000, movingTime: 1839, daysAgo: 100 },
      ],
    },
  });
  expect(runs.ok()).toBe(true);
  const segments = await page.request.post('/api/test/segments', {
    data: {
      segments: [
        {
          name: 'Grenadier Pond Loop',
          lat: PLACE.lat,
          lng: PLACE.lng,
          distance: 1000,
          averageGrade: 0.5,
          athleteCount: 4200,
          record: 170,
          pb: 175,
        },
      ],
    },
  });
  expect(segments.ok()).toBe(true);
}

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const continueButton = (page: Page) => page.getByRole('button', { name: 'Looks right, continue' });

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('a new Runner walks all three steps, then lands on Results', async ({ page }) => {
      await page.route('**/api/geocode?*', (route) => route.fulfill({ json: geocode }));
      await signIn(page, 'Kipyegon', 'F');
      await seedRunsAndSegments(page);
      await page.goto('/');

      // Step 1: the generated profile, and no KOM/QOM question (Strava has her sex).
      await expect(page).toHaveURL('/welcome');
      const steps = page.getByRole('list', { name: 'Steps' });
      await expect(steps.getByText('1. Your fitness')).toHaveAttribute('aria-current', 'step');
      await expect(heading(page, 'Here’s how fast we think you are')).toBeVisible();
      await expect(page.getByText(/^Estimated from Waterfront Marathon/)).toBeVisible();
      await expect(page.getByLabel('5K', { exact: true })).toHaveValue('14:43');
      await expect(page.getByRole('group', { name: /Which record/ })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
      await continueButton(page).click();

      // Step 2: the Search Area.
      await expect(heading(page, 'Where do you run?')).toBeVisible();
      const centre = page.getByRole('region', { name: 'Centre' });
      await centre.getByLabel('Place or postcode').fill('High Park');
      await centre.getByRole('button', { name: 'Search' }).click();
      await centre
        .getByRole('list', { name: 'Places found' })
        .getByRole('button', { name: PLACE.label })
        .click();
      await page.getByRole('button', { name: 'Find my targets' }).click();

      // Step 3: no runs with routes to crawl, so it's done at once with the Known Segment.
      await expect(heading(page, 'Your targets are ready')).toBeVisible();
      await expect(steps.getByText('3. Your targets')).toHaveAttribute('aria-current', 'step');
      await expect(
        page.getByText('None of your runs pass through here · 1 Segments found.'),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your targets (1)' })).toBeVisible();
      await expect(page.getByRole('row', { name: /Grenadier Pond Loop/ })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false);

      await page.getByRole('link', { name: 'See all results' }).click();
      await expect(page).toHaveURL('/results');
      await expect(heading(page, 'Results')).toBeVisible();
      await expect(page.getByRole('row', { name: /Grenadier Pond Loop/ })).toBeVisible();

      // Onboarded: a later visit lands on Results, and the wizard sends her there too.
      await page.goto('/');
      await expect(page).toHaveURL('/results');
      await page.goto('/welcome');
      await expect(page).toHaveURL('/results');
    });
  });
}

test('leaving at step 1 resumes the wizard on the next visit', async ({ page }) => {
  await signIn(page, 'Hassan', 'F');
  await seedRunsAndSegments(page);
  await page.goto('/');
  await expect(heading(page, 'Here’s how fast we think you are')).toBeVisible();

  // Edit a Benchmark, then leave without continuing.
  const fiveK = page.getByLabel('5K', { exact: true });
  await fiveK.fill('14:30');
  await fiveK.blur();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.goto('/fitness-profile');
  await expect(heading(page, 'Fitness Profile')).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL('/welcome');
  await expect(heading(page, 'Here’s how fast we think you are')).toBeVisible();
  await expect(fiveK).toHaveValue('14:30');
});

test('asks KOM or QOM only when Strava has no sex set, and remembers the answer', async ({
  page,
}) => {
  await signIn(page, 'Alex');
  await seedRunsAndSegments(page);
  await page.goto('/');

  const question = page.getByRole('group', { name: 'Which record should you chase?' });
  await expect(question).toBeVisible();
  await expect(continueButton(page)).toBeDisabled();
  await question.getByText('QOM (the women’s record)').click();
  await expect(question.getByRole('radio', { name: /QOM/ })).toBeChecked();
  await expect(continueButton(page)).toBeEnabled();

  await page.reload();
  await expect(question.getByRole('radio', { name: /QOM/ })).toBeChecked();
  await expect(continueButton(page)).toBeEnabled();
});

test('continue stays disabled until the Runner has two Benchmarks', async ({ page }) => {
  await signIn(page, 'Nia', 'F');
  await page.goto('/');

  await expect(page.getByText(/didn’t find any race-like runs/)).toBeVisible();
  await expect(continueButton(page)).toBeDisabled();
  const fiveK = page.getByLabel('5K', { exact: true });
  await fiveK.fill('16:00');
  await fiveK.blur();
  await page.getByRole('button', { name: 'Update all from this' }).click();
  await expect(page.getByLabel('10K', { exact: true })).toHaveValue('33:13');
  await expect(continueButton(page)).toBeEnabled();
});
