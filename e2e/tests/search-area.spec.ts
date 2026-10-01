import type { GeocodeResponse, LocateIpResponse } from '@mykom/shared';
import { expect, test, type Page } from './fixtures';
import { signIn } from './sign-in';

// Nominatim and the IP lookup are stubbed in the browser, so e2e never reaches them.
const geocode: GeocodeResponse = {
  results: [
    { label: 'Leeds, West Yorkshire, England, LS1 4DY, United Kingdom', lat: 53.797, lng: -1.548 },
    { label: 'LS1 4DY, Leeds, United Kingdom', lat: 53.7968, lng: -1.5479 },
  ],
};

const locateIp: LocateIpResponse = {
  available: true,
  location: {
    label: 'Bristol, England, United Kingdom',
    lat: 51.45,
    lng: -2.58,
    accuracyRadiusKm: 20,
  },
};

async function stubLocationApis(page: Page) {
  await page.route('**/api/geocode?*', (route) => route.fulfill({ json: geocode }));
  await page.route('**/api/locate-ip', (route) => route.fulfill({ json: locateIp }));
}

const savedArea = (page: Page) => page.getByTestId('saved-search-area');

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

for (const viewport of viewports) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('searches a postcode, picks a result, goes to Results, and the Search Area is restored', async ({
      page,
    }) => {
      await stubLocationApis(page);
      await signIn(page, 'Sam');
      await page.goto('/search-area');

      await expect(savedArea(page)).toHaveText('You haven’t set a Search Area yet.');
      const centre = page.getByRole('region', { name: 'Centre' });
      await centre.getByLabel('Place or postcode').fill('LS1 4DY');
      await centre.getByRole('button', { name: 'Search' }).click();
      await centre
        .getByRole('list', { name: 'Places found' })
        .getByRole('button', { name: 'LS1 4DY, Leeds, United Kingdom' })
        .click();
      const radius = page.getByRole('group', { name: 'Radius', exact: true });
      await expect(radius.getByRole('radio', { name: '10 km' })).toHaveAccessibleDescription(
        '10 km is slower, and uses more of the daily budget.',
      );
      await radius.getByText('2 km').click();
      await page.getByRole('button', { name: 'Save and see results' }).click();
      await expect(page).toHaveURL(/\/results$/);
      await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();

      await page.goto('/search-area');
      await expect(savedArea(page)).toHaveText(
        'Your Search Area: 2 km around LS1 4DY, Leeds, United Kingdom',
      );
      await expect(radius.getByRole('radio', { name: '2 km' })).toBeChecked();
      await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
    });

    test('starts mapping a whole area and removes it', async ({ page }) => {
      await stubLocationApis(page);
      await signIn(page, 'Mia');
      await page.goto('/search-area');

      const mapping = page.getByRole('region', { name: 'Map a whole area in the background' });
      await mapping.getByLabel('Place to map').fill('Leeds');
      await mapping.getByRole('button', { name: 'Search' }).click();
      await mapping
        .getByRole('list', { name: 'Places found' })
        .getByRole('button', { name: /^Leeds, West Yorkshire/ })
        .click();
      await expect(
        mapping.getByRole('group', { name: 'Mapped Area radius' }).getByRole('radio', {
          name: '25 km',
        }),
      ).toBeChecked();
      await mapping.getByRole('button', { name: 'Start mapping' }).click();

      const leeds = mapping
        .getByRole('list', { name: 'Mapped Areas' })
        .getByRole('listitem')
        .filter({ hasText: 'Leeds, West Yorkshire' });
      await expect(leeds).toContainText('· 25 km');
      // This Runner has no runs, so there's nothing to check and it's done at once.
      await expect(leeds.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
      await expect(leeds).toContainText('Done · 0 Known Segments');

      await page.reload();
      await expect(leeds).toBeVisible();
      await leeds.getByRole('button', { name: /^Remove Leeds/ }).click();
      await expect(mapping.getByRole('list', { name: 'Mapped Areas' })).toHaveCount(0);
      await page.reload();
      await expect(mapping.getByRole('button', { name: 'Start mapping' })).toBeVisible();
      await expect(mapping.getByRole('list', { name: 'Mapped Areas' })).toHaveCount(0);
    });
  });
}

test.describe('with geolocation granted', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: 51.5, longitude: -0.12 } });

  test('uses my location', async ({ page }) => {
    await stubLocationApis(page);
    await signIn(page, 'Gee');
    await page.goto('/search-area');

    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByTestId('chosen-centre')).toHaveText('Centre: My location');
    await expect(page.getByRole('group', { name: /Is this right\?/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save and see results' }).click();
    await expect(page).toHaveURL(/\/results$/);

    await page.goto('/search-area');
    await expect(savedArea(page)).toHaveText('Your Search Area: 5 km around My location');
  });
});

test.describe('with geolocation denied', () => {
  test.use({ permissions: [] });

  test('falls back to the IP location after asking if it’s right', async ({ page, context }) => {
    await context.clearPermissions();
    await stubLocationApis(page);
    await signIn(page, 'Ida');
    await page.goto('/search-area');

    await page.getByRole('button', { name: 'Use my location' }).click();
    const question = page.getByRole('group', { name: /Is this right\?/ });
    await expect(question).toContainText('near Bristol, England, United Kingdom');
    await expect(page.getByRole('button', { name: 'Save and see results' })).toBeDisabled();

    await question.getByRole('button', { name: 'Yes, use this' }).click();
    await page.getByRole('button', { name: 'Save and see results' }).click();
    await expect(page).toHaveURL(/\/results$/);

    await page.goto('/search-area');
    await expect(savedArea(page)).toHaveText(
      'Your Search Area: 5 km around Bristol, England, United Kingdom',
    );
  });
});
