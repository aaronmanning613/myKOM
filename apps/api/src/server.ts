import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadRootEnvFile, readEnv } from './env.js';
import { createDbGeocodeCache } from './geocode/cache.js';
import { createNominatimClient } from './geocode/nominatim.js';
import { openIpLocator, type IpLocator } from './locate-ip/locator.js';
import { createStravaClient } from './strava/client.js';
import { blockDeauthorize } from './strava/live-mode.js';
import { createLiveTokenStore } from './strava/live-token-store.js';
import { testModeStravaFetch } from './strava/test-fetch.js';
import { createDbTokenStore } from './strava/token-store.js';

loadRootEnvFile();
const env = readEnv();
const database = createDatabase(env.databaseUrl);
// Live mode signs in the real Runner with the live token file, and never lets Strava's
// deauthorize run (it would revoke the live token).
const liveTokenStore = env.liveMode ? createLiveTokenStore() : undefined;
const stravaClient = createStravaClient({
  clientId: env.stravaClientId,
  clientSecret: env.stravaClientSecret,
  tokenStore: liveTokenStore ?? createDbTokenStore(database.db),
  ...(env.testMode && { fetch: testModeStravaFetch }),
});
const strava = env.liveMode ? blockDeauthorize(stravaClient) : stravaClient;
const nominatim =
  env.nominatimUserAgent === undefined
    ? undefined
    : createNominatimClient({
        userAgent: env.nominatimUserAgent,
        cache: createDbGeocodeCache(database.db),
      });
// A missing or unreadable GeoLite2 database only turns the IP lookup off; it never stops startup.
let ipLocator: IpLocator | undefined;
let ipLocatorError: unknown;
try {
  ipLocator = await openIpLocator(env.geolite2CityDbPath);
} catch (error) {
  ipLocatorError = error;
}
const app = buildApp({
  logger: true,
  database,
  strava,
  nominatim,
  ipLocator,
  trustProxy: env.trustProxy,
  sessionSecret: env.sessionSecret,
  testRoutes: env.testMode,
  liveTokenStore,
});
if (env.testMode) app.log.warn('Test mode: test-only routes are on and Strava is stubbed');
if (env.liveMode) {
  app.log.warn('Live mode: Strava is real (live token file), and deauthorize is blocked');
}
if (!nominatim) app.log.warn('NOMINATIM_USER_AGENT is not set, so place search is unavailable');
if (ipLocatorError) {
  app.log.error({ err: ipLocatorError }, 'Could not open the GeoLite2 City database');
} else if (!ipLocator) {
  app.log.warn(
    `No GeoLite2 City database at ${env.geolite2CityDbPath}, so IP location is unavailable (run pnpm geolite2:update)`,
  );
}
app.addHook('onClose', () => database.close());

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
