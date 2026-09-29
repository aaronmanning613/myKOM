import { expect, test } from '@playwright/test';
import { signIn } from './sign-in';

test.describe('signed out', () => {
  for (const path of ['/fitness-profile', '/search-area', '/results']) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    });
  }

  test('Connect with Strava points at the API sign-in route', async ({ page }) => {
    await page.goto('/login');
    const connect = page.getByRole('link', { name: 'Connect with Strava' });
    await expect(connect).toBeVisible();
    await expect(connect).toHaveAttribute('href', '/api/auth/strava');
  });

  test('Strava is told to call back to the web app, where the state cookie lives', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/api/auth/strava', { maxRedirects: 0 });
    expect(response.status()).toBe(302);

    const authorize = new URL(response.headers()['location'] ?? '');
    const callback = new URL(authorize.searchParams.get('redirect_uri') ?? '');
    expect(callback.origin).toBe(new URL(baseURL!).origin);
    expect(callback.pathname).toBe('/api/auth/strava/callback');
  });
});

test.describe('signed in', () => {
  test('the header shows the Runner, and the login page sends them home', async ({ page }) => {
    await signIn(page, 'Sifan');
    await page.goto('/login');

    await expect(page).toHaveURL('/');
    const header = page.getByRole('banner');
    await expect(header.getByText('Sifan')).toBeVisible();
    await expect(header.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Log in' })).toHaveCount(0);
  });

  test('log out ends the session', async ({ page }) => {
    await signIn(page);
    await page.goto('/fitness-profile');

    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Log in' })).toBeVisible();
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await page.goto('/fitness-profile');
    await expect(page).toHaveURL('/login');
  });

  test('disconnect asks for confirmation, then deletes the Runner', async ({ page }) => {
    await signIn(page, 'Kelvin');
    await page.goto('/fitness-profile');
    const header = page.getByRole('banner');

    // Cancelling keeps everything.
    await header.getByRole('button', { name: 'Disconnect' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Disconnect Strava?' });
    await expect(dialog).toContainText('permanently deletes all your myKOM data');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(header.getByText('Kelvin')).toBeVisible();
    expect((await page.request.get('/api/me')).ok()).toBe(true);

    // Confirming disconnects and deletes. Keep the session cookie to show the Runner is gone,
    // not just signed out.
    const session = (await page.context().cookies()).find((c) => c.name === 'mykom_session')!;
    await header.getByRole('button', { name: 'Disconnect' }).click();
    await dialog.getByRole('button', { name: 'Disconnect and delete my data' }).click();

    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('status')).toHaveText(
      'Strava is disconnected and your myKOM data has been deleted.',
    );
    await expect(header.getByRole('link', { name: 'Log in' })).toBeVisible();
    const replayed = await page.request.get('/api/me', {
      headers: { cookie: `${session.name}=${session.value}` },
    });
    expect(replayed.status()).toBe(401);
  });
});
