import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { liveTestRoutes } from './auth/live-test-routes.js';
import { testRoutes } from './auth/test-routes.js';
import type { Database } from './db/client.js';
import { fitnessProfileRoutes } from './fitness-profile/routes.js';
import type { NominatimClient } from './geocode/nominatim.js';
import { geocodeRoutes } from './geocode/routes.js';
import type { IpLocator } from './locate-ip/locator.js';
import { locateIpRoutes } from './locate-ip/routes.js';
import { endSession } from './auth/session.js';
import { searchAreaRoutes } from './search-area/routes.js';
import { StravaError, StravaRevokedError, type StravaClient } from './strava/client.js';
import type { LiveTokenStore } from './strava/live-token-store.js';
import type { TokenCipher } from './strava/token-cipher.js';

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  database: Pick<Database, 'db' | 'isReachable'>;
  /**
   * Its `onRevoked` should delete the Runner (see `deleteRunner`); the app then ends the
   * session of any request that hit the revocation.
   */
  strava: StravaClient;
  /** Encrypts Strava tokens at rest. `strava`'s token store must use the same one. */
  tokenCipher: TokenCipher;
  /** Backs `GET /api/geocode`; without it, place search replies 503. */
  nominatim?: NominatimClient;
  /** Backs `GET /api/locate-ip`; without it, the lookup replies `{ available: false }`. */
  ipLocator?: IpLocator;
  /** Fastify's `trustProxy`: which proxies' X-Forwarded-For to believe for the client IP. */
  trustProxy?: FastifyServerOptions['trustProxy'];
  /** Signs the session and OAuth state cookies. */
  sessionSecret: string;
  /** Registers test-only routes such as `POST /api/test/login`. Never on in production. */
  testRoutes?: boolean;
  /**
   * Live mode only: registers `POST /api/test/login-live`, which signs in the real Runner from
   * this store. `strava` must use the same store. Never on in production.
   */
  liveTokenStore?: LiveTokenStore;
};

export type HealthStatus = {
  ok: boolean;
  db: 'up' | 'down';
};

export function buildApp({
  logger = false,
  database,
  strava,
  tokenCipher,
  nominatim,
  ipLocator,
  trustProxy = false,
  sessionSecret,
  testRoutes: enableTestRoutes = false,
  liveTokenStore,
}: BuildAppOptions) {
  const app = Fastify({ logger, trustProxy });
  app.register(fastifyCookie, { secret: sessionSecret });

  app.setErrorHandler((error, request, reply) => {
    // The Strava client has already deleted a revoked Runner's data, so sign them out like
    // `requireRunner` does for a Runner who no longer exists.
    if (error instanceof StravaRevokedError) {
      request.log.warn({ runnerId: error.runnerId }, 'Strava access revoked; Runner deleted');
      endSession(request, reply);
      return reply.code(401).send({ error: 'signed_out' });
    }
    // Otherwise Fastify would reply with Strava's own status, and a 401 would look like a sign-out.
    if (error instanceof StravaError) {
      request.log.error(error, 'Strava request failed');
      return reply.code(502).send({ error: 'strava' });
    }
    throw error;
  });

  app.get('/api/health', async (_request, reply): Promise<HealthStatus> => {
    const dbUp = await database.isReachable();
    reply.code(dbUp ? 200 : 503);
    return { ok: dbUp, db: dbUp ? 'up' : 'down' };
  });

  app.register(authRoutes, { db: database.db, strava, tokenCipher });
  app.register(fitnessProfileRoutes, { db: database.db });
  app.register(searchAreaRoutes, { db: database.db });
  app.register(geocodeRoutes, { db: database.db, nominatim });
  app.register(locateIpRoutes, { db: database.db, ipLocator });
  if (enableTestRoutes) app.register(testRoutes, { db: database.db, tokenCipher });
  if (liveTokenStore) {
    app.register(liveTestRoutes, { db: database.db, strava, liveTokenStore, tokenCipher });
  }

  return app;
}
