// Helpers for tests that build the app against the test database (see global-setup.ts).
import { afterAll, inject, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase, type Database } from '../db/client.js';
import { createStravaClient } from '../strava/client.js';
import { createDbTokenStore } from '../strava/token-store.js';

export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-characters';

/** A connection to the test database, closed after the file's tests. */
export function useTestDatabase(): Database {
  const database = createDatabase(inject('testDatabaseUrl'));
  afterAll(() => database.close());
  return database;
}

/** The app wired to the test database, with a mocked `fetch` behind the Strava client. */
export function buildTestApp(
  database: Pick<Database, 'db' | 'isReachable'>,
  { testRoutes = false }: { testRoutes?: boolean } = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const strava = createStravaClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenStore: createDbTokenStore(database.db),
    fetch,
  });
  const app = buildApp({ database, strava, sessionSecret: TEST_SESSION_SECRET, testRoutes });
  return { app, fetch };
}

/** A Strava athlete id unlikely to clash with other tests sharing the database. */
export function randomAthleteId(): number {
  return 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
}
