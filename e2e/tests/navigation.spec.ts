import { expect, test } from '@playwright/test';
import { signIn } from './sign-in';

const pages = [
  { link: 'Fitness Profile', path: '/fitness-profile', heading: 'Fitness Profile' },
  { link: 'Search Area', path: '/search-area', heading: 'Search Area' },
  { link: 'Results', path: '/results', heading: 'Results' },
];

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

// No horizontal scrolling at any width.
async function overflows(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

for (const viewport of viewports) {
  test.describe(`navigation at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('reaches every route via the nav', async ({ page }) => {
      await signIn(page, 'Faith');
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Main' });

      for (const { link, path, heading } of pages) {
        await nav.getByRole('link', { name: link }).click();
        await expect(page).toHaveURL(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        await expect(nav.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page');
      }

      await page.getByRole('link', { name: 'myKOM' }).click();
      await expect(page).toHaveURL('/');
      expect(await overflows(page)).toBe(false);
    });

    test('reaches the login page when signed out', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('banner').getByRole('link', { name: 'Log in' }).click();
      await expect(page).toHaveURL('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
      expect(await overflows(page)).toBe(false);
    });
  });
}

test('the results page is a coming-soon placeholder', async ({ page }) => {
  await signIn(page);
  await page.goto('/results');
  await expect(page.getByText(/coming soon/i)).toBeVisible();
});
