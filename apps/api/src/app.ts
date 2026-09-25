import Fastify, { type FastifyServerOptions } from 'fastify';

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
};

export function buildApp({ logger = false }: BuildAppOptions = {}) {
  const app = Fastify({ logger });

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
