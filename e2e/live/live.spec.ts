// Signed in as the real Strava Runner (`pnpm test:e2e:live`). About one Strava call per test.
// Never click Disconnect here: in live mode the API blocks it, and the last test proves that.
import type { GeocodeResponse } from '@mykom/shared';
import { expect, test } from '@playwright/test';
import { liveTokenFileDigest, signInLive } from './sign-in-live';

test('signs in live, and the header shows the real Runner', async ({ page }) => {
  const me = await signInLive(page);
  expect(me.firstName).not.toBe('');
  await page.goto('/');

  const header = page.getByRole('banner');
  await expect(header.getByText(me.firstName, { exact: true })).toBeVisible();
  if (me.avatarUrl) {
    await expect(header.locator(`img[src="${me.avatarUrl}"]`)).toBeVisible();
  } else {
    // No Strava photo: the header shows the first initial instead.
    await expect(header.getByText(me.firstName[0]!.toUpperCase(), { exact: true })).toBeVisible();
  }
  await expect(header.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  expect((await page.request.get('/api/me')).ok()).toBe(true);
});

test('the Fitness Profile loads and saves for the real Runner', async ({ page }) => {
  await signInLive(page);
  await page.goto('/fitness-profile');
  const fiveK = page.getByLabel('5K', { exact: true });
  const fiveKRow = page.getByRole('row').filter({ has: fiveK });
  const original = await fiveK.inputValue();
  const wasPinned = (await fiveKRow.textContent())?.includes('📌 yours') ?? false;

  // A different time each run, so the reload proves this run's save.
  const time = `19:${String(new Date().getSeconds()).padStart(2, '0')}`;
  await fiveK.fill(time);
  await fiveK.blur();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.reload();
  await expect(fiveK).toHaveValue(time);
  await expect(fiveKRow).toContainText('📌 yours');

  // Put the Runner's own 5K back: their pin, the generated time, or nothing.
  if (original && !wasPinned) {
    await page.getByRole('button', { name: 'Use generated 5K' }).click();
    await expect(page.getByRole('status')).toHaveText('5K is back to the generated time.');
  } else {
    await fiveK.fill(original);
    await fiveK.blur();
    await expect(page.getByRole('status')).toHaveText('Saved.');
  }
  await expect(fiveK).toHaveValue(original);
});

test('the Search Area loads and saves for the real Runner', async ({ page }) => {
  // Nominatim stays stubbed: the live tests are about Strava.
  const label = `Leeds (live e2e ${Date.now()})`;
  const geocode: GeocodeResponse = { results: [{ label, lat: 53.797, lng: -1.548 }] };
  await page.route('**/api/geocode?*', (route) => route.fulfill({ json: geocode }));
  await signInLive(page);
  await page.goto('/search-area');
  // An earlier run may have saved a Search Area already, or the database may be fresh.
  await expect(page.getByLabel('Place or postcode')).toBeVisible();

  await page.getByLabel('Place or postcode').fill('Leeds');
  await page.getByRole('button', { name: 'Search' }).click();
  await page
    .getByRole('list', { name: 'Places found' })
    .getByRole('button', { name: label })
    .click();
  // By role, not text: a Search Area saved at 1 km by an earlier run also shows "1 km".
  // Saving searches: the starred Segments read, plus any of the Runner's runs through Leeds.
  await page.getByRole('radio', { name: '1 km' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Search Area saved.');

  await page.reload();
  await expect(page.getByTestId('saved-search-area')).toHaveText(
    `Your Search Area: 1 km around ${label}`,
  );
});

test('Log out ends the real Runner’s session', async ({ page }) => {
  await signInLive(page);
  await page.goto('/fitness-profile');

  await page.getByRole('button', { name: 'Log out' }).click();

  await expect(page).toHaveURL('/login');
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('Disconnect is blocked in live mode and leaves the token file untouched', async ({ page }) => {
  await signInLive(page);
  const before = await liveTokenFileDigest();

  const res = await page.request.post('/api/auth/disconnect');

  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({
    error: 'deauthorize_blocked',
    message: expect.stringContaining('blocked in live test mode'),
  });
  expect((await liveTokenFileDigest()) === before, 'token file unchanged').toBe(true);
  // The Runner and their session are still there.
  expect((await page.request.get('/api/me')).ok()).toBe(true);
});
