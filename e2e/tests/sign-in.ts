import { expect, type Page } from '@playwright/test';

/**
 * Signs a brand-new Runner in through the API's test-only route (never real Strava).
 * The request shares the page's cookie jar, so the page is signed in afterwards.
 */
export async function signIn(page: Page, firstName = 'Test') {
  const res = await page.request.post('/api/test/login', { data: { firstName } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: number; firstName: string };
}
