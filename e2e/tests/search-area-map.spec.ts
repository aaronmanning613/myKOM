import type { GeocodeResponse } from '@mykom/shared';
import { expect, test, type Page } from './fixtures';
import { signIn } from './sign-in';

// Nominatim is stubbed in the browser, so e2e never reaches it.
const geocode: GeocodeResponse = {
  results: [
    { label: 'Leeds, West Yorkshire, England, LS1 4DY, United Kingdom', lat: 53.797, lng: -1.548 },
    { label: 'LS1 4DY, Leeds, United Kingdom', lat: 53.7968, lng: -1.5479 },
  ],
};

const OTTAWA = { label: 'Ottawa, Ontario', lat: 45.42, lng: -75.69 };

/** Saves a 5 km Search Area around Ottawa for a new Runner with no runs. */
async function saveOttawa(page: Page) {
  const search = await page.request.post('/api/search', { data: { ...OTTAWA, radiusKm: 5 } });
  expect(search.ok()).toBe(true);
}

const mapRegion = (page: Page) => page.getByRole('region', { name: 'Search Area map' });

/** The map's zoom, as Leaflet reports it (see SearchAreaMap's ReportZoom). */
const zoomOf = async (page: Page) =>
  Number(await mapRegion(page).locator('.leaflet-container').getAttribute('data-zoom'));

/** Where the pin is, as Leaflet holds it (see SearchAreaMap's Pin). */
async function pinPosition(page: Page) {
  const pin = mapRegion(page).locator('.search-area-pin');
  return {
    lat: Number(await pin.getAttribute('data-lat')),
    lng: Number(await pin.getAttribute('data-lng')),
  };
}

const circleWidth = async (page: Page) =>
  (await mapRegion(page).locator('.search-area-map-circle').boundingBox())!.width;

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('draws the saved Search Area, refits to a new radius, and follows a place search', async ({
      page,
      tiles,
    }) => {
      await page.route('**/api/geocode?*', (route) => route.fulfill({ json: geocode }));
      await signIn(page, 'Pip');
      await saveOttawa(page);
      await page.goto('/search-area');

      const map = mapRegion(page);
      await expect(map.locator('.search-area-pin')).toBeVisible();
      await expect(map.locator('.search-area-map-circle')).toBeVisible();
      await expect(page.getByText('Tap or click the map to drop the pin')).toBeVisible();
      expect(await pinPosition(page)).toEqual({ lat: OTTAWA.lat, lng: OTTAWA.lng });

      // 5 km → 1 km: the map refits, zooming in. A metre's width on screen grows by 2^Δzoom, so
      // the circle's width over that is in proportion to its radius: a fifth of what it was.
      const before = { zoom: await zoomOf(page), width: await circleWidth(page) };
      await page.getByRole('group', { name: 'Radius', exact: true }).getByText('1 km').click();
      await expect.poll(() => zoomOf(page)).toBeGreaterThan(before.zoom);
      // Let the zoom animation settle.
      await page.waitForTimeout(500);
      const after = { zoom: await zoomOf(page), width: await circleWidth(page) };
      const radiusRatio = (after.width / before.width) * 2 ** (before.zoom - after.zoom);
      expect(radiusRatio).toBeGreaterThan(0.15);
      expect(radiusRatio).toBeLessThan(0.25);

      // A search with matches chooses the first at once, and the pin follows it.
      const centre = page.getByRole('region', { name: 'Centre' });
      await centre.getByLabel('Place or postcode').fill('LS1 4DY');
      await centre.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByTestId('chosen-centre')).toHaveText(
        `Centre: ${geocode.results[0]!.label}`,
      );
      await expect.poll(() => pinPosition(page)).toEqual({ lat: 53.797, lng: -1.548 });
      // The map refits on it, so the pin is in view within the map.
      await page.waitForTimeout(500);
      const mapBox = (await map.boundingBox())!;
      const pinBox = (await map.locator('.search-area-pin').boundingBox())!;
      expect(pinBox.x).toBeGreaterThanOrEqual(mapBox.x);
      expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
      expect(pinBox.y).toBeGreaterThanOrEqual(mapBox.y);
      expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height);

      expect(tiles.requested.length).toBeGreaterThan(0);
      expect(tiles.served).toEqual(tiles.requested);
      expect(await noHorizontalOverflow(page)).toBe(true);
    });

    test('shows the whole world with no pin before a Search Area is set', async ({
      page,
      tiles,
    }) => {
      await signIn(page, 'Noa');
      await page.goto('/search-area');

      const map = mapRegion(page);
      await expect(map.locator('.leaflet-container')).toHaveAttribute('data-zoom', '2');
      await expect(map.locator('.search-area-pin')).toHaveCount(0);
      await expect(map.locator('.search-area-map-circle')).toHaveCount(0);
      expect(tiles.served).toEqual(tiles.requested);
      expect(await noHorizontalOverflow(page)).toBe(true);
    });
  });
}
