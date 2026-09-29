import { expect, test } from '@playwright/test';
import { signIn } from './sign-in';

test('enters Benchmarks, which persist across a reload', async ({ page }) => {
  await signIn(page, 'Bea');
  await page.goto('/fitness-profile');

  const time = (label: string) => page.getByLabel(label, { exact: true });

  await time('1 mile').fill('5:75');
  await time('1 mile').blur();
  await expect(page.getByText('Minutes and seconds must be under 60')).toBeVisible();

  await time('1 mile').fill('6:10');
  await time('5K').fill('20:00');
  await time('10K').fill('2520');
  await time('8K').fill('32:40');
  await expect(page.getByText('4:00/km')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Fitness Profile saved.');

  await page.reload();
  await expect(time('1 mile')).toHaveValue('6:10');
  await expect(time('5K')).toHaveValue('20:00');
  await expect(time('10K')).toHaveValue('42:00');
  await expect(time('8K')).toHaveValue('32:40');
  await expect(time('400m')).toHaveValue('');

  await page.getByRole('button', { name: 'Clear 5K' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Fitness Profile saved.');

  await page.reload();
  await expect(time('5K')).toHaveValue('');
  await expect(time('1 mile')).toHaveValue('6:10');
  await expect(time('8K')).toHaveValue('32:40');
});
