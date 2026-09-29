// The live-mode sign-in route, so the real-account e2e tests (`pnpm test:e2e:live`) can sign in as
// the real Runner without automating Strava's login or consent pages. buildApp registers it only
// in live mode (E2E_LIVE=1), which readEnv never allows in production.
//
// The caller sends no token: the server loads the live token store itself. Never put a token in a
// response or log line.
import type { Me } from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { loadSuggestionSummary } from '../fitness-profile/store.js';
import { StravaError, type StravaClient } from '../strava/client.js';
import { LiveTokenError, type LiveTokenStore } from '../strava/live-token-store.js';
import type { TokenCipher } from '../strava/token-cipher.js';
import { findRunner, upsertRunnerFromStrava } from './runners.js';
import { startSession } from './session.js';

export type LiveTestRoutesOptions = {
  db: Database['db'];
  /** Must use `liveTokenStore` as its token store (see server.ts). */
  strava: StravaClient;
  liveTokenStore: LiveTokenStore;
  tokenCipher: TokenCipher;
};

/**
 * Stored in `strava_tokens` instead of the live token. The live token only ever lives in the token
 * file, because Strava rotates the refresh token and a copy in the database would go stale.
 */
export const LIVE_TOKEN_PLACEHOLDER = 'in-live-token-file';

/** The live token store ignores Runner ids. */
const LIVE_RUNNER = 0;

export const liveTestRoutes: FastifyPluginAsync<LiveTestRoutesOptions> = async (
  app,
  { db, strava, liveTokenStore, tokenCipher },
) => {
  // Signs the real Runner in: a valid access token (refreshed if needed), the real athlete from
  // Strava, then the same upsert as the OAuth callback.
  app.post('/api/test/login-live', async (request, reply) => {
    let athlete;
    let grantedScopes: string[];
    try {
      const token = await liveTokenStore.read();
      if (!token) {
        return reply.code(503).send({
          error: 'no_live_token',
          message:
            'There is no live token: set STRAVA_REFRESH_TOKEN in .env, or run `pnpm strava:authorize`',
        });
      }
      // Unknown for a token seeded from .env; `pnpm strava:authorize` records them.
      grantedScopes = token.scopes ?? [];
      athlete = await strava.getAthlete(await strava.getValidAccessToken(LIVE_RUNNER));
    } catch (err) {
      if (!(err instanceof StravaError || err instanceof LiveTokenError)) throw err;
      request.log.error(err, 'Live sign-in failed');
      return reply.code(502).send({ error: 'live_sign_in_failed', message: err.message });
    }

    const runnerId = await upsertRunnerFromStrava(
      db,
      tokenCipher,
      {
        athlete,
        accessToken: LIVE_TOKEN_PLACEHOLDER,
        refreshToken: LIVE_TOKEN_PLACEHOLDER,
        expiresAt: new Date(0),
      },
      grantedScopes,
    );
    startSession(request, reply, runnerId);
    const runner = await findRunner(db, runnerId);
    const me: Me = {
      id: runnerId,
      firstName: athlete.firstName,
      avatarUrl: athlete.avatarUrl,
      onboarded: runner?.onboardedAt != null,
      suggestion: await loadSuggestionSummary(db, runnerId),
    };
    return me;
  });
};
