import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { authRoutes } from './auth/routes.js';
import type { Database } from './db/client.js';
import type { StravaClient } from './strava/client.js';

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  database: Pick<Database, 'db' | 'isReachable'>;
  strava: StravaClient;
  /** Signs the session and OAuth state cookies. */
  sessionSecret: string;
};

export type HealthStatus = {
  ok: boolean;
  db: 'up' | 'down';
};

export function buildApp({ logger = false, database, strava, sessionSecret }: BuildAppOptions) {
  const app = Fastify({ logger });
  app.register(fastifyCookie, { secret: sessionSecret });

  app.get('/api/health', async (_request, reply): Promise<HealthStatus> => {
    const dbUp = await database.isReachable();
    reply.code(dbUp ? 200 : 503);
    return { ok: dbUp, db: dbUp ? 'up' : 'down' };
  });

  app.register(authRoutes, { db: database.db, strava });

  return app;
}
