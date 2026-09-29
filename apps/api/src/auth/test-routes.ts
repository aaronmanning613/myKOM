// Test-only routes, so end-to-end tests can sign in without real Strava credentials.
// buildApp registers them only when `testRoutes` is on, which readEnv never allows in production.
import { randomInt } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { STRAVA_SCOPES } from '../strava/client.js';
import type { TokenCipher } from '../strava/token-cipher.js';
import type { Me } from './routes.js';
import { upsertRunnerFromStrava } from './runners.js';
import { startSession } from './session.js';

export type TestRoutesOptions = {
  db: Database['db'];
  tokenCipher: TokenCipher;
};

type TestLoginBody = { firstName?: string } | undefined;

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const testRoutes: FastifyPluginAsync<TestRoutesOptions> = async (
  app,
  { db, tokenCipher },
) => {
  // Creates a new Runner with placeholder Strava tokens and signs them in.
  app.post<{ Body: TestLoginBody }>('/api/test/login', async (request, reply) => {
    const firstName = request.body?.firstName || 'Test';
    const runnerId = await upsertRunnerFromStrava(
      db,
      tokenCipher,
      {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        // Far enough ahead that nothing tries to refresh it.
        expiresAt: new Date(Date.now() + ONE_YEAR_MS),
        athlete: {
          id: randomInt(1, 2 ** 47),
          firstName,
          sex: null,
          avatarUrl: null,
          isSubscriber: false,
        },
      },
      [...STRAVA_SCOPES],
    );
    startSession(request, reply, runnerId);
    const me: Me = { id: runnerId, firstName, avatarUrl: null };
    return me;
  });
};
