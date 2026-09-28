import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import type { StravaClient } from '../strava/client.js';
import { DeauthorizeBlockedError } from '../strava/live-mode.js';
import { requireRunner } from './guard.js';
import { deleteRunner, upsertRunnerFromStrava } from './runners.js';
import { endSession, sessionRunnerId, startSession } from './session.js';

export const STATE_COOKIE = 'mykom_oauth_state';
const STATE_COOKIE_PATH = '/api/auth/strava';
const STATE_MAX_AGE_SECONDS = 10 * 60;

/** What `GET /api/me` returns for the signed-in Runner. */
export type Me = {
  id: number;
  firstName: string;
  avatarUrl: string | null;
};

/** Why the callback sent the Runner back to the login page (`/login?error=...`). */
export type LoginError = 'access_denied' | 'invalid_state' | 'strava';

export type AuthRoutesOptions = {
  db: Database['db'];
  strava: StravaClient;
};

type CallbackQuery = { code?: string; state?: string; scope?: string; error?: string };

// Strava redirects the browser back to the host it was sent from (the web app, via its proxy).
function callbackUrl(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}/api/auth/strava/callback`;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { db, strava }) => {
  app.get('/api/auth/strava', async (request, reply) => {
    const state = randomBytes(24).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, {
      path: STATE_COOKIE_PATH,
      httpOnly: true,
      // Lax so the cookie comes back on Strava's top-level redirect to the callback.
      sameSite: 'lax',
      secure: request.protocol === 'https',
      signed: true,
      maxAge: STATE_MAX_AGE_SECONDS,
    });
    return reply.redirect(strava.authorizeUrl({ redirectUri: callbackUrl(request), state }));
  });

  app.get<{ Querystring: CallbackQuery }>('/api/auth/strava/callback', async (request, reply) => {
    const { code, state, scope, error } = request.query;
    const stateCookie = request.cookies[STATE_COOKIE];
    const expectedState = stateCookie ? request.unsignCookie(stateCookie) : undefined;
    reply.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
    const toLogin = (reason: LoginError) => reply.redirect(`/login?error=${reason}`);

    if (!state || !expectedState?.valid || expectedState.value !== state) {
      return toLogin('invalid_state');
    }
    if (error || !code) return toLogin('access_denied');

    // Strava reports the scopes the Runner actually granted here, not in the token response.
    // TODO(decision): what to do when a Runner unticks scopes myKOM needs (e.g. activity:read_all).
    const grantedScopes = (scope ?? '').split(',').filter(Boolean);
    let runnerId: number;
    try {
      runnerId = await upsertRunnerFromStrava(db, await strava.exchangeCode(code), grantedScopes);
    } catch (err) {
      request.log.error(err, 'Strava sign-in failed');
      return toLogin('strava');
    }
    startSession(request, reply, runnerId);
    return reply.redirect('/');
  });

  app.get('/api/me', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const me: Me = { id: runner.id, firstName: runner.firstName, avatarUrl: runner.avatarUrl };
    return me;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    endSession(request, reply);
    return reply.code(204).send();
  });

  // Strava's API Policy requires deleting a Runner's data when they disconnect.
  app.post('/api/auth/disconnect', async (request, reply) => {
    const runnerId = sessionRunnerId(request);
    if (runnerId === undefined) return reply.code(401).send({ error: 'signed_out' });

    try {
      await strava.deauthorize(await strava.getValidAccessToken(runnerId));
    } catch (err) {
      // Live test mode: keep everything, so the live token and the real Runner survive.
      if (err instanceof DeauthorizeBlockedError) {
        return reply.code(403).send({ error: 'deauthorize_blocked', message: err.message });
      }
      // The Runner asked for their data to go, so delete it even when Strava can't be reached
      // or the token was already revoked; they can still revoke access in Strava's settings.
      // TODO(decision): whether a failed deauthorize should block deletion so they can retry.
      request.log.warn(err, 'Strava deauthorize failed during disconnect');
    }
    await deleteRunner(db, runnerId);
    endSession(request, reply);
    return reply.code(204).send();
  });
};
