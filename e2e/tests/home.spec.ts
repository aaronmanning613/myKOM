import { expect, test } from './fixtures';

test('home page shows the health status', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'myKOM', level: 1 })).toBeVisible();
  const status = page.getByRole('region', { name: 'System status' });
  await expect(status.getByRole('term')).toHaveText(['API', 'Database']);
  await expect(status.getByRole('definition')).toHaveText(['OK', 'Up']);
});
