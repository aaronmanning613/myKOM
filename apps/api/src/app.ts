import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { testRoutes } from './auth/test-routes.js';
import type { Database } from './db/client.js';
import { fitnessProfileRoutes } from './fitness-profile/routes.js';
import type { NominatimClient } from './geocode/nominatim.js';
import { geocodeRoutes } from './geocode/routes.js';
import type { IpLocator } from './locate-ip/locator.js';
import { locateIpRoutes } from './locate-ip/routes.js';
import { searchAreaRoutes } from './search-area/routes.js';
import type { StravaClient } from './strava/client.js';

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  database: Pick<Database, 'db' | 'isReachable'>;
  strava: StravaClient;
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
};

export type HealthStatus = {
  ok: boolean;
  db: 'up' | 'down';
};

export function buildApp({
  logger = false,
  database,
  strava,
  nominatim,
  ipLocator,
  trustProxy = false,
  sessionSecret,
  testRoutes: enableTestRoutes = false,
}: BuildAppOptions) {
  const app = Fastify({ logger, trustProxy });
  app.register(fastifyCookie, { secret: sessionSecret });

  app.get('/api/health', async (_request, reply): Promise<HealthStatus> => {
    const dbUp = await database.isReachable();
    reply.code(dbUp ? 200 : 503);
    return { ok: dbUp, db: dbUp ? 'up' : 'down' };
  });

  app.register(authRoutes, { db: database.db, strava });
  app.register(fitnessProfileRoutes, { db: database.db });
  app.register(searchAreaRoutes, { db: database.db });
  app.register(geocodeRoutes, { db: database.db, nominatim });
  app.register(locateIpRoutes, { db: database.db, ipLocator });
  if (enableTestRoutes) app.register(testRoutes, { db: database.db });

  return app;
}
