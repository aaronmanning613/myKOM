import type { Me } from '@mykom/shared';
import { expect, type Page } from './fixtures';

/**
 * Signs a brand-new Runner in through the API's test-only route (never real Strava).
 * The request shares the page's cookie jar, so the page is signed in afterwards. `sex` is
 * Strava's; unset by default.
 */
export async function signIn(page: Page, firstName = 'Test', sex?: 'M' | 'F') {
  const res = await page.request.post('/api/test/login', { data: { firstName, sex } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Me;
}
