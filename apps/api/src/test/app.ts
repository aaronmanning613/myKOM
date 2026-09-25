// Helpers for tests that build the app against the test database (see global-setup.ts).
import { afterAll, inject, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { createDatabase, type Database } from '../db/client.js';
import { createDbGeocodeCache } from '../geocode/cache.js';
import { createNominatimClient } from '../geocode/nominatim.js';
import { createThrottle } from '../geocode/throttle.js';
import type { IpLocator } from '../locate-ip/locator.js';
import { createStravaClient } from '../strava/client.js';
import { createDbTokenStore } from '../strava/token-store.js';

export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-characters';

/** A connection to the test database, closed after the file's tests. */
export function useTestDatabase(): Database {
  const database = createDatabase(inject('testDatabaseUrl'));
  afterAll(() => database.close());
  return database;
}

/**
 * The app wired to the test database, with mocked `fetch`es behind the Strava client (`fetch`)
 * and the Nominatim client (`nominatimFetch`).
 */
export function buildTestApp(
  database: Pick<Database, 'db' | 'isReachable'>,
  {
    testRoutes = false,
    nominatim: withNominatim = true,
    ipLocator,
    trustProxy,
  }: {
    testRoutes?: boolean;
    /** false builds the app as if NOMINATIM_USER_AGENT were unset. */
    nominatim?: boolean;
    /** Leave out to build the app as if the GeoLite2 City database were missing. */
    ipLocator?: IpLocator;
    trustProxy?: BuildAppOptions['trustProxy'];
  } = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const strava = createStravaClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenStore: createDbTokenStore(database.db),
    fetch,
  });
  const nominatimFetch = vi.fn<typeof globalThis.fetch>();
  const nominatim = createNominatimClient({
    userAgent: 'myKOM-tests',
    cache: createDbGeocodeCache(database.db),
    fetch: nominatimFetch,
    // The throttle has its own tests; don't slow every route test down with it.
    throttle: createThrottle(0),
  });
  const app = buildApp({
    database,
    strava,
    nominatim: withNominatim ? nominatim : undefined,
    ipLocator,
    trustProxy,
    sessionSecret: TEST_SESSION_SECRET,
    testRoutes,
  });
  return { app, fetch, nominatimFetch };
}

/** A Strava athlete id unlikely to clash with other tests sharing the database. */
export function randomAthleteId(): number {
  return 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
}
