// `POST /internal/tick`: Cloud Scheduler's 5-minute call, authenticated with a Google OIDC token
// from the Scheduler's service account.
import type { FastifyPluginAsync } from 'fastify';
import type { TickResult } from '../jobs/tick.js';
import type { OidcVerifier } from './google-oidc.js';

export type TickRoutesOptions = {
  tick: () => Promise<TickResult>;
  /** Checks the bearer token. Without it, every call is refused unless `allowWithoutToken`. */
  verifyToken?: OidcVerifier;
  /** Test mode only: run the tick without a token. Never in production. */
  allowWithoutToken?: boolean;
};

export const tickRoutes: FastifyPluginAsync<TickRoutesOptions> = async (
  app,
  { tick, verifyToken, allowWithoutToken = false },
) => {
  // Cloud Scheduler may send a body with any content type; the tick ignores it.
  app.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined));

  app.post('/internal/tick', async (request, reply) => {
    if (!allowWithoutToken) {
      const token = /^Bearer (.+)$/i.exec(request.headers.authorization ?? '')?.[1];
      if (!token) return reply.code(401).send({ error: 'unauthorized' });
      if (!verifyToken) {
        request.log.warn('Tick refused: TICK_OIDC_AUDIENCE / TICK_SERVICE_ACCOUNT are not set');
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const verified = await verifyToken(token);
      if (!verified.ok) {
        request.log.warn({ reason: verified.reason }, 'Tick refused: bad OIDC token');
        return reply.code(401).send({ error: 'unauthorized' });
      }
    }
    const result = await tick();
    request.log.info(result, 'Tick');
    return result;
  });
};
