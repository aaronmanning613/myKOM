import { encodePolyline, type LatLng, type Results } from '@mykom/shared';
import { expect, test, type Page } from './fixtures';
import { signIn } from './sign-in';

const CENTRE = { lat: 45.42, lng: -75.69 };
const offset = (from: LatLng, dLat: number, dLng: number) => ({
  lat: from.lat + dLat,
  lng: from.lng + dLng,
});

/**
 * A Runner with a 2 km Search Area and four Known Segments, apart on the map: a target with its
 * route stored, a target with only its start, a Nearest miss, and a Suspicious record (with a
 * route, to show it's still left off).
 */
async function seedMappedArea(page: Page) {
  await signIn(page, 'Mara');
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

  // A straight diagonal line of about 700 m, so clicking the middle of its box lands on it. (A
  // level line's box has no height, which Playwright counts as not visible.)
  const routeStart = offset(CENTRE, 0.002, -0.004);
  const route = [routeStart, offset(routeStart, 0.004, 0.008)];
  const glitchStart = offset(CENTRE, -0.006, -0.008);
  const base = { distance: 1000, averageGrade: 0.5 };
  const segments = await page.request.post('/api/test/segments', {
    data: {
      segments: [
        {
          ...base,
          ...routeStart,
          name: 'Canal Dash',
          athleteCount: 5400,
          record: 170,
          pb: 175,
          polyline: encodePolyline(route),
        },
        {
          ...base,
          ...offset(CENTRE, -0.006, 0.006),
          name: 'Rideau Hill',
          distance: 800,
          athleteCount: 900,
          record: 140,
          pb: 130,
        },
        {
          ...base,
          ...offset(CENTRE, 0.009, 0.009),
          name: 'Fast Friend',
          athleteCount: 300,
          record: 150,
          pb: 200,
        },
        {
          ...base,
          ...glitchStart,
          name: 'Glitch Straight',
          athleteCount: 2000,
          record: 90,
          pb: null,
          polyline: encodePolyline([glitchStart, offset(glitchStart, 0, 0.004)]),
        },
      ],
    },
  });
  expect(segments.ok()).toBe(true);

  const stored = (await (await page.request.get('/api/results')).json()) as Results;
  const idOf = (name: string) =>
    [...stored.targets, ...stored.nearestMisses, ...stored.suspicious].find((r) => r.name === name)!
      .segmentId;
  expect(stored.targets.map((r) => r.name).sort()).toEqual(['Canal Dash', 'Rideau Hill']);
  expect(stored.nearestMisses.map((r) => r.name)).toEqual(['Fast Friend']);
  expect(stored.suspicious.map((r) => r.name)).toEqual(['Glitch Straight']);
  return {
    route: idOf('Canal Dash'),
    startOnly: idOf('Rideau Hill'),
    nearestMiss: idOf('Fast Friend'),
    suspicious: idOf('Glitch Straight'),
  };
}

/**
 * A Runner with a 2 km Search Area and 25 route targets on a 5 × 5 grid, each a short diagonal,
 * ranked Route 1 to Route 25 (fewest athletes last).
 */
async function seedManyRoutes(page: Page) {
  await signIn(page, 'Mara');
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

  const segments = await page.request.post('/api/test/segments', {
    data: {
      segments: Array.from({ length: 25 }, (_, i) => {
        const start = offset(CENTRE, (Math.floor(i / 5) - 2) * 0.003, ((i % 5) - 2) * 0.004);
        return {
          ...start,
          name: `Route ${i + 1}`,
          distance: 1000,
          averageGrade: 0.5,
          athleteCount: 1000 - i,
          record: 170,
          pb: 175,
          polyline: encodePolyline([start, offset(start, 0.001, 0.002)]),
        };
      }),
    },
  });
  expect(segments.ok()).toBe(true);
  const stored = (await (await page.request.get('/api/results')).json()) as Results;
  expect(stored.targets.map((r) => r.name)).toEqual(
    Array.from({ length: 25 }, (_, i) => `Route ${i + 1}`),
  );
}

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('draws the targets and Nearest misses, with popups linking to Strava', async ({
      page,
      tiles,
    }) => {
      const ids = await seedMappedArea(page);
      await page.goto('/results');

      const map = page.getByRole('region', { name: 'Segment map' });
      await expect(map).toBeVisible();
      await expect(
        page.getByText('Nearest misses · a line is the whole Segment, a dot is its start'),
      ).toBeVisible();

      const route = map.locator(`.segment-map-${ids.route}.segment-map-route`);
      const startOnly = map.locator(`.segment-map-${ids.startOnly}.segment-map-start`);
      const nearestMiss = map.locator(`.segment-map-${ids.nearestMiss}.segment-map-start`);
      await expect(route).toHaveCount(1);
      await expect(startOnly).toHaveCount(1);
      await expect(nearestMiss).toHaveCount(1);
      await expect(map.locator('.segment-map-route')).toHaveCount(1);
      await expect(map.locator('.segment-map-start')).toHaveCount(2);
      await expect(map.locator(`.segment-map-${ids.suspicious}`)).toHaveCount(0);
      await expect(route).toHaveAttribute('stroke', '#ea580c');
      await expect(nearestMiss).toHaveAttribute('fill', '#2563eb');

      // By name: a closed popup lingers for its 200 ms fade-out.
      const popupFor = (name: string) => map.locator('.leaflet-popup', { hasText: name });

      await route.click();
      let popup = popupFor('Canal Dash');
      await expect(popup).toBeVisible();
      await expect(popup).toContainText('Your target');
      await expect(popup).not.toContainText('Start point only');
      const link = popup.getByRole('link', { name: 'View Canal Dash on Strava' });
      await expect(link).toHaveText('View on Strava');
      await expect(link).toHaveAttribute('href', `https://www.strava.com/segments/${ids.route}`);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveCSS('color', 'rgb(252, 82, 0)');

      await startOnly.click();
      popup = popupFor('Rideau Hill');
      await expect(popup).toBeVisible();
      await expect(popup.getByRole('img', { name: 'Held' })).toBeVisible();
      await expect(popup).toContainText('Start point only');
      await expect(popup.getByRole('link', { name: 'View Rideau Hill on Strava' })).toHaveAttribute(
        'href',
        `https://www.strava.com/segments/${ids.startOnly}`,
      );

      // Close it first: the popup can cover the next dot.
      await popup.getByRole('button', { name: /close/i }).click();
      await expect(popup).toHaveCount(0);
      await nearestMiss.click();
      await expect(popupFor('Fast Friend')).toContainText('Nearest miss');
      await expect(map.locator('.leaflet-popup')).toHaveCount(1);

      // The map asked for tiles, and the fixture answered every one: none reached OSM.
      expect(tiles.served.length).toBeGreaterThan(0);
      await expect
        .poll(() => tiles.requested.filter((url) => !tiles.served.includes(url)))
        .toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });

    test('"Show on map" brings a Segment into view and opens its popup', async ({ page }) => {
      const ids = await seedMappedArea(page);
      await page.goto('/results');

      const map = page.getByRole('region', { name: 'Segment map' });
      await expect(map.locator(`.segment-map-${ids.startOnly}`)).toHaveCount(1);
      const targets = page.getByRole('region', { name: /^Your targets/ });
      const nearestMisses = page.getByRole('region', { name: /^Nearest misses/ });
      await expect(targets.getByRole('button', { name: /on map/ })).toHaveCount(2);
      await expect(nearestMisses.getByRole('button', { name: /on map/ })).toHaveCount(1);
      await expect(
        page.getByRole('region', { name: /^Suspicious records/ }).getByRole('button'),
      ).toHaveCount(0);

      // Scroll the map away first, so the button has to bring it back.
      const button = targets.getByRole('button', { name: 'Show Rideau Hill on map' });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await button.click();

      const popup = map.locator('.leaflet-popup', { hasText: 'Rideau Hill' });
      await expect(popup).toBeVisible();
      await expect(popup).toBeInViewport();
      await expect(popup).toContainText('Your target');
      await expect(popup).toContainText('Start point only');
      await expect(popup.getByRole('link', { name: 'View Rideau Hill on Strava' })).toHaveAttribute(
        'href',
        `https://www.strava.com/segments/${ids.startOnly}`,
      );
      // Zoomed in on its start.
      await expect(map.locator('.leaflet-tile[src*="/16/"]').first()).toBeAttached();

      // Another Segment's button swaps the popup over.
      await targets.getByRole('button', { name: 'Show Canal Dash on map' }).click();
      await expect(map.locator('.leaflet-popup', { hasText: 'Canal Dash' })).toBeVisible();
      await expect(popup).toHaveCount(0);
    });

    test('draws only the shown rows, and "Show more" adds to the map without moving it', async ({
      page,
    }) => {
      await seedManyRoutes(page);
      await page.goto('/results');

      const map = page.getByRole('region', { name: 'Segment map' });
      await expect(map.locator('.segment-map-route')).toHaveCount(20);

      // Zoom in first: a refit would undo it. Where the Search Area circle sits within the map
      // changes with any pan or zoom (and not with the page's scroll).
      const circleInMap = () =>
        map.evaluate((section) => {
          const outer = section.getBoundingClientRect();
          const box = section.querySelector('.segment-map-search-area')!.getBoundingClientRect();
          // Whole pixels: scrolling the page shifts both boxes by a sub-pixel float error.
          return {
            x: Math.round(box.x - outer.x),
            y: Math.round(box.y - outer.y),
            width: Math.round(box.width),
          };
        });
      const fitted = await circleInMap();
      await map.getByRole('button', { name: 'Zoom in' }).click();
      await expect
        .poll(async () => (await circleInMap()).width)
        .toBeGreaterThan(fitted.width * 1.5);
      // Let the zoom animation settle.
      await page.waitForTimeout(500);
      const zoomed = await circleInMap();

      await page.getByRole('button', { name: 'Show 5 more Your targets' }).click();
      await expect(map.locator('.segment-map-route')).toHaveCount(25);
      // Long enough for a refit's animation to have moved the circle.
      await page.waitForTimeout(500);
      expect(await circleInMap()).toEqual(zoomed);

      // A row revealed by "Show more" still has a working "Show on map".
      await page.getByRole('button', { name: 'Show Route 25 on map' }).click();
      await expect(map.locator('.leaflet-popup', { hasText: 'Route 25' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  });
}
