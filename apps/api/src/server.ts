import { TICK_INTERVAL_MINUTES } from '@mykom/shared';
import { buildApp } from './app.js';
import { deleteRunner } from './auth/runners.js';
import { createDatabase } from './db/client.js';
import { recordRead } from './jobs/budget.js';
import { onCrawlJobFinished } from './jobs/crawls.js';
import { createStravaJobHandlers } from './jobs/handlers.js';
import { createJobQueue } from './jobs/queue.js';
import { createTick } from './jobs/tick.js';
import { createGoogleOidcVerifier } from './internal/google-oidc.js';
import { loadRootEnvFile, readEnv, usesDevTokenEncryptionKey } from './env.js';
import { createDbGeocodeCache } from './geocode/cache.js';
import { createNominatimClient } from './geocode/nominatim.js';
import { openIpLocator, type IpLocator } from './locate-ip/locator.js';
import { createStravaClient } from './strava/client.js';
import { blockDeauthorize } from './strava/live-mode.js';
import { createLiveTokenStore } from './strava/live-token-store.js';
import { testModeStravaFetch } from './strava/test-fetch.js';
import { createTokenCipher } from './strava/token-cipher.js';
import { createDbTokenStore } from './strava/token-store.js';

loadRootEnvFile();
const env = readEnv();
const database = createDatabase(env.databaseUrl);
const tokenCipher = createTokenCipher(env.tokenEncryptionKey);
// Live mode signs in the real Runner with the live token file, and never lets Strava's
// deauthorize run (it would revoke the live token).
const liveTokenStore = env.liveMode ? createLiveTokenStore() : undefined;
const stravaClient = createStravaClient({
  clientId: env.stravaClientId,
  clientSecret: env.stravaClientSecret,
  tokenStore: liveTokenStore ?? createDbTokenStore(database.db, tokenCipher),
  ...(env.testMode && { fetch: testModeStravaFetch }),
  // Revoking myKOM on strava.com deletes the Runner's data, like Disconnect (Strava API Policy).
  onRevoked: (runnerId) => deleteRunner(database.db, runnerId),
  onRead: (read) => recordRead(database.db, read),
});
const strava = env.liveMode ? blockDeauthorize(stravaClient) : stravaClient;
const nominatim =
  env.nominatimUserAgent === undefined
    ? undefined
    : createNominatimClient({
        userAgent: env.nominatimUserAgent,
        cache: createDbGeocodeCache(database.db),
      });
// The IP fallback is off in production. Elsewhere, a missing or unreadable GeoLite2 database
// only turns the IP lookup off; it never stops startup.
const ipFallback = !env.production;
let ipLocator: IpLocator | undefined;
let ipLocatorError: unknown;
try {
  if (ipFallback) ipLocator = await openIpLocator(env.geolite2CityDbPath);
} catch (error) {
  ipLocatorError = error;
}
// Handlers log through the app's logger, which exists only once the app is built.
const jobLog = { warn: (details: object, message: string) => app.log.warn(details, message) };
const queue = createJobQueue(database.db, createStravaJobHandlers({ log: jobLog }), {
  onFinished: onCrawlJobFinished,
});
const tick = createTick({ db: database.db, queue, strava });
const app = buildApp({
  logger: true,
  database,
  strava,
  tokenCipher,
  nominatim,
  ipLocator,
  ipFallback,
  trustProxy: env.trustProxy,
  sessionSecret: env.sessionSecret,
  testRoutes: env.testMode,
  debugRoutes: !env.production,
  liveTokenStore,
  queue,
  tick: {
    tick: () => tick(),
    verifyToken: env.tickOidc && createGoogleOidcVerifier(env.tickOidc),
    allowWithoutToken: env.testMode,
  },
});
if (env.testMode) app.log.warn('Test mode: test-only routes are on and Strava is stubbed');
if (env.liveMode) {
  app.log.warn('Live mode: Strava is real (live token file), and deauthorize is blocked');
}
if (usesDevTokenEncryptionKey(env)) {
  app.log.warn('TOKEN_ENCRYPTION_KEY is not set, so Strava tokens use the development key');
}
if (!nominatim) app.log.warn('NOMINATIM_USER_AGENT is not set, so place search is unavailable');
if (ipLocatorError) {
  app.log.error({ err: ipLocatorError }, 'Could not open the GeoLite2 City database');
} else if (ipFallback && !ipLocator) {
  app.log.warn(
    `No GeoLite2 City database at ${env.geolite2CityDbPath}, so IP location is unavailable (run pnpm geolite2:update)`,
  );
}
if (env.production && !env.tickOidc) {
  app.log.warn(
    'TICK_OIDC_AUDIENCE / TICK_SERVICE_ACCOUNT are not set, so /internal/tick refuses every call',
  );
}
// Outside production there's no Cloud Scheduler: the server ticks itself.
let tickTimer: NodeJS.Timeout | undefined;
if (!env.production) {
  tickTimer = setInterval(
    () => {
      tick().then(
        (result) => app.log.info(result, 'Tick'),
        (error: unknown) => app.log.error(error, 'Tick failed'),
      );
    },
    TICK_INTERVAL_MINUTES * 60 * 1000,
  );
  tickTimer.unref();
}
app.addHook('onClose', async () => {
  clearInterval(tickTimer);
  await database.close();
});

try {
  await app.listen({ host: env.host, port: env.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
