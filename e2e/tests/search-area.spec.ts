import type { GeocodeResponse, LocateIpResponse } from '@mykom/shared';
import { expect, test, type Page } from '@playwright/test';
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

test('searches a postcode, picks a result, and the Search Area is restored after reload', async ({
  page,
}) => {
  await stubLocationApis(page);
  await signIn(page, 'Sam');
  await page.goto('/search-area');

  await expect(savedArea(page)).toHaveText('You haven’t set a Search Area yet.');
  await page.getByLabel('Place or postcode').fill('LS1 4DY');
  await page.getByRole('button', { name: 'Search' }).click();
  await page
    .getByRole('list', { name: 'Places found' })
    .getByRole('button', { name: 'LS1 4DY, Leeds, United Kingdom' })
    .click();
  await page.getByText('2 km').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Search Area saved.');

  await page.reload();
  await expect(savedArea(page)).toHaveText(
    'Your Search Area: 2 km around LS1 4DY, Leeds, United Kingdom',
  );
  await expect(page.getByRole('radio', { name: '2 km' })).toBeChecked();
  await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
});

test.describe('with geolocation granted', () => {
  test.use({ permissions: ['geolocation'], geolocation: { latitude: 51.5, longitude: -0.12 } });

  test('uses my location', async ({ page }) => {
    await stubLocationApis(page);
    await signIn(page, 'Gee');
    await page.goto('/search-area');

    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.getByTestId('chosen-centre')).toHaveText('Centre: My location');
    await expect(page.getByRole('group', { name: /Is this right\?/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('Search Area saved.');

    await page.reload();
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
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    await question.getByRole('button', { name: 'Yes, use this' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toHaveText('Search Area saved.');

    await page.reload();
    await expect(savedArea(page)).toHaveText(
      'Your Search Area: 5 km around Bristol, England, United Kingdom',
    );
  });
});
