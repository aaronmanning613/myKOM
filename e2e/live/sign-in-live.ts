import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** The live token file (see apps/api/src/strava/live-token-store.ts). Never print its contents. */
export const LIVE_TOKEN_PATH = fileURLToPath(
  new URL('../../.strava-live-token.json', import.meta.url),
);

export type LiveMe = { id: number; firstName: string; avatarUrl: string | null };

/**
 * Signs the real Runner in through the API's live-mode route. The server loads the live token
 * itself; nothing token-shaped passes through the test. Each sign-in costs one Strava call
 * (GET /athlete), plus a refresh when the token is about to expire.
 * Skips the test, with the server's reason, when there is no live token.
 */
export async function signInLive(page: Page): Promise<LiveMe> {
  const res = await page.request.post('/api/test/login-live');
  if (res.status() === 503) {
    const { message } = (await res.json()) as { message: string };
    test.skip(true, `Skipping the live e2e tests: ${message}`);
  }
  expect(res.status(), 'live sign-in').toBe(200);
  return (await res.json()) as LiveMe;
}

/** A digest of the live token file, so tests can compare it without ever showing a token. */
export async function liveTokenFileDigest(): Promise<string> {
  return createHash('sha256')
    .update(await readFile(LIVE_TOKEN_PATH))
    .digest('hex');
}
