import { expect, test } from '@playwright/test';

const pages = [
  { link: 'Fitness Profile', path: '/fitness-profile', heading: 'Fitness Profile' },
  { link: 'Search Area', path: '/search-area', heading: 'Search Area' },
  { link: 'Results', path: '/results', heading: 'Results' },
  { link: 'Log in', path: '/login', heading: 'Log in' },
];

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 375, height: 667 } },
];

for (const viewport of viewports) {
  test.describe(`navigation at ${viewport.name} width`, () => {
    test.use({ viewport: viewport.size });

    test('reaches every route via the nav', async ({ page }) => {
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

      // No horizontal scrolling at any width.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  });
}

test('the results page is a coming-soon placeholder', async ({ page }) => {
  await page.goto('/results');
  await expect(page.getByText(/coming soon/i)).toBeVisible();
});
