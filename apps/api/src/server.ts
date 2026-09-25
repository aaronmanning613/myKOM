import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadRootEnvFile, readEnv } from './env.js';
import { createDbGeocodeCache } from './geocode/cache.js';
import { createNominatimClient } from './geocode/nominatim.js';
import { createStravaClient } from './strava/client.js';
import { testModeStravaFetch } from './strava/test-fetch.js';
import { createDbTokenStore } from './strava/token-store.js';

loadRootEnvFile();
const env = readEnv();
const database = createDatabase(env.databaseUrl);
const strava = createStravaClient({
  clientId: env.stravaClientId,
  clientSecret: env.stravaClientSecret,
  tokenStore: createDbTokenStore(database.db),
  ...(env.testMode && { fetch: testModeStravaFetch }),
});
const nominatim =
  env.nominatimUserAgent === undefined
    ? undefined
    : createNominatimClient({
        userAgent: env.nominatimUserAgent,
        cache: createDbGeocodeCache(database.db),
      });
const app = buildApp({
  logger: true,
  database,
  strava,
  nominatim,
  sessionSecret: env.sessionSecret,
  testRoutes: env.testMode,
});
if (env.testMode) app.log.warn('Test mode: test-only routes are on and Strava is stubbed');
if (!nominatim) app.log.warn('NOMINATIM_USER_AGENT is not set, so place search is unavailable');
app.addHook('onClose', () => database.close());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
