import type { GeocodeResponse, ReverseGeocodeResponse, SearchAreaResponse } from '@mykom/shared';
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

/** The map's zoom, as Leaflet reports it (see SearchAreaMap's ReportView). */
const zoomOf = async (page: Page) =>
  Number(await mapRegion(page).locator('.leaflet-container').getAttribute('data-zoom'));

/** The map's visible bounds, as Leaflet reports them (see SearchAreaMap's ReportView). */
async function boundsOf(page: Page) {
  const bbox = await mapRegion(page).locator('.leaflet-container').getAttribute('data-bounds');
  const [west, south, east, north] = bbox!.split(',').map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { west, south, east, north };
}

/** The reverse lookup's stub: a name made from the point asked about. */
const reverseLabel = (lat: string, lng: string) => `Near ${lat}, ${lng}`;

async function stubReverse(page: Page, status = 200) {
  await page.route('**/api/geocode/reverse?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const lat = params.get('lat')!;
    const lng = params.get('lng')!;
    const body: ReverseGeocodeResponse = {
      result: { label: reverseLabel(lat, lng), lat: Number(lat), lng: Number(lng) },
    };
    return status === 200
      ? route.fulfill({ json: body })
      : route.fulfill({ status, json: { error: 'geocoding_unavailable' } });
  });
}

/** The saved Search Area, read back from the API. */
async function savedSearchArea(page: Page) {
  const response = await page.request.get('/api/search-area');
  return ((await response.json()) as SearchAreaResponse).searchArea!;
}

/** Clicks the map away from its pin, the +/− control and the attribution. */
async function clickMap(page: Page) {
  const box = (await mapRegion(page).boundingBox())!;
  await mapRegion(page)
    .locator('.leaflet-container')
    .click({ position: { x: box.width * 0.75, y: box.height * 0.3 } });
}

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

    test('drops the pin with a click, drags it, names it, and saves it', async ({
      page,
      tiles,
    }) => {
      await page.route('**/api/geocode?*', (route) => route.fulfill({ json: geocode }));
      await stubReverse(page);
      await signIn(page, 'Ren');
      await saveOttawa(page);
      await page.goto('/search-area');

      const map = mapRegion(page);
      const pin = map.locator('.search-area-pin');
      await expect(pin).toBeVisible();
      const zoom = await zoomOf(page);
      const chosen = page.getByTestId('chosen-centre');

      // A click drops the pin there, without moving the view.
      await clickMap(page);
      await expect.poll(() => pinPosition(page)).not.toEqual({ lat: OTTAWA.lat, lng: OTTAWA.lng });
      const dropped = await pinPosition(page);
      await expect(chosen).toHaveText(
        `Centre: ${reverseLabel(String(dropped.lat), String(dropped.lng))}`,
      );
      expect(await zoomOf(page)).toBe(zoom);

      // Dragging the pin's head moves it again, still at the same zoom.
      const box = (await pin.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await page.mouse.down();
      await page.mouse.move(box.x - 30, box.y + 40, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => pinPosition(page)).not.toEqual(dropped);
      const dragged = await pinPosition(page);
      const draggedLabel = reverseLabel(String(dragged.lat), String(dragged.lng));
      await expect(chosen).toHaveText(`Centre: ${draggedLabel}`);
      expect(await zoomOf(page)).toBe(zoom);
      const bounds = await boundsOf(page);

      await page.getByRole('button', { name: 'Save and see results' }).click();
      await expect(page).toHaveURL(/\/results$/);
      await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();

      const saved = await savedSearchArea(page);
      expect(saved).toMatchObject({ label: draggedLabel, lat: dragged.lat, lng: dragged.lng });
      expect([saved.lat, saved.lng]).not.toEqual([OTTAWA.lat, OTTAWA.lng]);
      expect(saved.lat).toBeGreaterThan(bounds.south);
      expect(saved.lat).toBeLessThan(bounds.north);
      expect(saved.lng).toBeGreaterThan(bounds.west);
      expect(saved.lng).toBeLessThan(bounds.east);

      expect(tiles.served).toEqual(tiles.requested);
      expect(await noHorizontalOverflow(page)).toBe(true);
    });

    test('saves “Dropped pin” when no place name comes back', async ({ page }) => {
      await stubReverse(page, 503);
      await signIn(page, 'Kit');
      await saveOttawa(page);
      await page.goto('/search-area');
      await expect(mapRegion(page).locator('.search-area-pin')).toBeVisible();

      await clickMap(page);
      await expect(page.getByTestId('chosen-centre')).toHaveText('Centre: Dropped pin');
      await expect(page.getByRole('alert')).toHaveCount(0);
      const dropped = await pinPosition(page);

      await page.getByRole('button', { name: 'Save and see results' }).click();
      await expect(page).toHaveURL(/\/results$/);
      expect(await savedSearchArea(page)).toMatchObject({ label: 'Dropped pin', ...dropped });
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
