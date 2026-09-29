// The live smoke test: a real 1 km search on the test account returns ranked rows, within
// MAX_SEARCH_READS Strava reads counted by the app's own usage counters.
import type { LatLng, Results } from '@mykom/shared';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { signInLive } from './sign-in-live';

/** The most the search (its interactive calls, first burst and results polls) may read. */
const MAX_SEARCH_READS = 30;
/**
 * The background reads the search is allowed, below MAX_SEARCH_READS so the starred Segments
 * read and a drain overlapping with the dev tick still fit.
 */
const BACKGROUND_READ_ALLOWANCE = 25;
const RESULTS_POLLS = 5;

async function readsToday(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/test/live-reads');
  expect(res.ok(), 'live reads').toBe(true);
  return ((await res.json()) as { readsToday: number }).readsToday;
}

const rowCount = (results: Results) =>
  results.targets.length + results.nearestMisses.length + results.suspicious.length;

test('a real 1 km search returns ranked rows within its Strava read cap', async ({ page }) => {
  test.setTimeout(240_000);
  await signInLive(page);
  const { request } = page;

  // Setup, before counting: a Fitness Profile generated from the latest runs (one read).
  const regenerate = await request.post('/api/fitness-profile/regenerate', { timeout: 60_000 });
  expect(regenerate.ok(), 'regenerate the Fitness Profile').toBe(true);
  const startRes = await request.get('/api/test/live-run-start');
  expect(startRes.ok(), 'the Runner has a run with a route').toBe(true);
  const start = (await startRes.json()) as LatLng;

  // The cap: the Runner's daily counter is raised so background work stops within the allowance.
  const allowance = await request.post('/api/test/live-read-allowance', {
    data: { reads: BACKGROUND_READ_ALLOWANCE },
  });
  expect(allowance.ok()).toBe(true);
  const before = await readsToday(request);

  const searchRes = await request.post('/api/search', {
    data: { label: 'Live smoke test run start', lat: start.lat, lng: start.lng, radiusKm: 1 },
    timeout: 60_000,
  });
  expect(searchRes.ok(), 'search').toBe(true);
  let results = (await searchRes.json()) as Results;
  // Each poll drains the search's work for up to ~2 s, still within the allowance.
  for (let poll = 0; poll < RESULTS_POLLS && results.pending && rowCount(results) === 0; poll++) {
    const res = await request.get('/api/results');
    expect(res.ok(), 'results').toBe(true);
    results = (await res.json()) as Results;
  }

  const reads = (await readsToday(request)) - before;
  console.log(
    `Live search: ${reads} Strava reads; ${results.knownCount} Known Segments with details, ` +
      `${results.targets.length} targets, ${results.nearestMisses.length} nearest misses, ` +
      `${results.suspicious.length} suspicious.`,
  );
  expect(reads, 'Strava reads for the search').toBeLessThanOrEqual(MAX_SEARCH_READS);
  expect(results.searchArea.radiusKm).toBe(1);
  expect(results.enoughBenchmarks).toBe(true);
  expect(rowCount(results), 'ranked rows').toBeGreaterThan(0);

  // The Results page shows them.
  await page.goto('/results');
  await expect(page.getByText(/Known Segments are Achievable/)).toBeVisible();
  await expect(page.getByRole('region').getByRole('row').nth(1)).toBeVisible();
  expect((await readsToday(request)) - before).toBeLessThanOrEqual(MAX_SEARCH_READS);
});
