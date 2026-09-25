import Fastify, { type FastifyServerOptions } from 'fastify';

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  /** Reports whether the database is reachable; used by the health route. */
  isDatabaseReachable?: () => Promise<boolean>;
};

export type HealthStatus = {
  ok: boolean;
  db: 'up' | 'down';
};

export function buildApp({
  logger = false,
  isDatabaseReachable = async () => false,
}: BuildAppOptions = {}) {
  const app = Fastify({ logger });

  app.get('/api/health', async (_request, reply): Promise<HealthStatus> => {
    const dbUp = await isDatabaseReachable();
    reply.code(dbUp ? 200 : 503);
    return { ok: dbUp, db: dbUp ? 'up' : 'down' };
  });

  return app;
}
