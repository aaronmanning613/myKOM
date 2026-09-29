// Helpers for tests that build the app against the test database (see global-setup.ts).
import postgres from 'postgres';
import { afterAll, beforeAll, inject, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../app.js';
import { deleteRunner } from '../auth/runners.js';
import { createDatabase, type Database } from '../db/client.js';
import { ensureDatabase } from '../db/ensure-database.js';
import { runMigrations } from '../db/migrations.js';
import { DEV_TOKEN_ENCRYPTION_KEY } from '../env.js';
import { createDbGeocodeCache } from '../geocode/cache.js';
import { createNominatimClient } from '../geocode/nominatim.js';
import { createThrottle } from '../geocode/throttle.js';
import { recordRead } from '../jobs/budget.js';
import { onCrawlJobFinished } from '../jobs/crawls.js';
import { createStravaJobHandlers } from '../jobs/handlers.js';
import { createJobQueue } from '../jobs/queue.js';
import type { IpLocator } from '../locate-ip/locator.js';
import { createStravaClient } from '../strava/client.js';
import { createTokenCipher } from '../strava/token-cipher.js';
import { createDbTokenStore } from '../strava/token-store.js';

export const TEST_SESSION_SECRET = 'test-session-secret-at-least-32-characters';

/** Encrypts Strava tokens in test apps (global-setup migrates with the same key). */
export const testTokenCipher = createTokenCipher(DEV_TOKEN_ENCRYPTION_KEY);

/** A connection to the test database, closed after the file's tests. */
export function useTestDatabase(): Database {
  const database = createDatabase(inject('testDatabaseUrl'));
  afterAll(() => database.close());
  return database;
}

/**
 * A fresh, migrated database of the file's own, dropped after its tests. For tests that drain
 * the job queue: a drain claims any runnable job, so other files' jobs in the shared test
 * database would get in the way.
 */
export function useOwnTestDatabase(): { database: () => Database } {
  const url = new URL(inject('testDatabaseUrl'));
  url.pathname = `/mykom_test_${process.pid}_${Date.now()}`;
  let database: Database | undefined;
  beforeAll(async () => {
    await ensureDatabase(url.toString());
    database = createDatabase(url.toString());
    await runMigrations(database.db, testTokenCipher);
  });
  afterAll(async () => {
    await database?.close();
    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { onnotice: () => {} });
    await admin.unsafe(`drop database if exists "${url.pathname.slice(1)}"`);
    await admin.end();
  });
  return {
    database: () => {
      if (!database) throw new Error('The database is ready only inside tests and hooks');
      return database;
    },
  };
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
    tick,
  }: {
    testRoutes?: boolean;
    /** false builds the app as if NOMINATIM_USER_AGENT were unset. */
    nominatim?: boolean;
    /** Leave out to build the app as if the GeoLite2 City database were missing. */
    ipLocator?: IpLocator;
    trustProxy?: BuildAppOptions['trustProxy'];
    tick?: BuildAppOptions['tick'];
  } = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const strava = createStravaClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenStore: createDbTokenStore(database.db, testTokenCipher),
    fetch,
    onRevoked: (runnerId) => deleteRunner(database.db, runnerId),
    onRead: (read) => recordRead(database.db, read),
  });
  const queue = createJobQueue(database.db, createStravaJobHandlers({ log: { warn: () => {} } }), {
    onFinished: onCrawlJobFinished,
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
    tokenCipher: testTokenCipher,
    nominatim: withNominatim ? nominatim : undefined,
    ipLocator,
    trustProxy,
    sessionSecret: TEST_SESSION_SECRET,
    testRoutes,
    tick,
    queue,
  });
  return { app, fetch, nominatimFetch, strava, queue };
}

/** A Strava athlete id unlikely to clash with other tests sharing the database. */
export function randomAthleteId(): number {
  return 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
}
