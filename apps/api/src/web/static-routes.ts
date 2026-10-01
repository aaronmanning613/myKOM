import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Paths that belong to the server, so an unknown one is a 404 rather than the web app. */
const SERVER_PREFIXES = ['/api/', '/internal/'];

/**
 * Serves the built web app (apps/web/dist) from the API's origin, as production does: its files
 * as they are, and index.html for any other GET so client routes such as /results survive a
 * reload. Unknown `/api` and `/internal` paths stay 404s. Call on the root instance, since the
 * not-found handler must cover every route.
 */
export function serveWebApp(app: FastifyInstance, root: string): void {
  app.register(fastifyStatic, {
    root,
    wildcard: false,
    cacheControl: false,
    setHeaders: (reply, path) => {
      // Vite fingerprints everything under assets/; index.html must always be re-checked.
      reply.header(
        'cache-control',
        path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0]!;
    const isServerPath = SERVER_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix));
    if ((request.method !== 'GET' && request.method !== 'HEAD') || isServerPath) {
      // Fastify's own 404 body.
      return reply.code(404).send({
        message: `Route ${request.method}:${request.url} not found`,
        error: 'Not Found',
        statusCode: 404,
      });
    }
    return reply.sendFile('index.html');
  });
}
