// The live-mode sign-in route, so the real-account e2e tests (`pnpm test:e2e:live`) can sign in as
// the real Runner without automating Strava's login or consent pages. buildApp registers it only
// in live mode (E2E_LIVE=1), which readEnv never allows in production.
//
// The caller sends no token: the server loads the live token store itself. Never put a token in a
// response or log line.
import { RUNNER_DAILY_READS, decodePolyline, type LatLng, type Me } from '@mykom/shared';
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { activities, stravaReadUsage } from '../db/schema.js';
import { loadSuggestionSummary } from '../fitness-profile/store.js';
import { budgetStatus, windowStart } from '../jobs/budget.js';
import { StravaError, StravaRevokedError, type StravaClient } from '../strava/client.js';
import { LiveTokenError, type LiveTokenStore } from '../strava/live-token-store.js';
import type { TokenCipher } from '../strava/token-cipher.js';
import { syncFirstSignIn } from '../sync/activities.js';
import { requireRunner } from './guard.js';
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

/** The signed-in Runner's Strava reads today (UTC), from the usage counters. */
export type LiveReads = { readsToday: number };

/** The start of the Runner's latest stored run with a route, as a centre to search around. */
export type LiveRunStart = LatLng;

type ReadAllowanceBody = { reads: number };

/** The live token store ignores Runner ids. */
const LIVE_RUNNER = 0;

export const liveTestRoutes: FastifyPluginAsync<LiveTestRoutesOptions> = async (
  app,
  { db, strava, liveTokenStore, tokenCipher },
) => {
  // Signs the real Runner in: a valid access token (refreshed if needed), the real athlete from
  // Strava, then the same upsert and first sync as the OAuth callback.
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
    // The first live sign-in syncs like the OAuth callback's first sign-in, so the visit check
    // later sees only new runs rather than the whole history.
    const before = await findRunner(db, runnerId);
    if (before && !before.activitiesCheckedAt) {
      try {
        await syncFirstSignIn({ db, strava }, runnerId);
      } catch (err) {
        request.log.error(err, 'First Strava sync failed');
        if (err instanceof StravaRevokedError) {
          return reply.code(502).send({ error: 'live_sign_in_failed', message: err.message });
        }
      }
    }
    startSession(request, reply, runnerId);
    const runner = await findRunner(db, runnerId);
    const me: Me = {
      id: runnerId,
      firstName: athlete.firstName,
      avatarUrl: athlete.avatarUrl,
      sex: athlete.sex,
      recordGender: runner?.recordGender ?? null,
      onboarded: runner?.onboardedAt != null,
      suggestion: await loadSuggestionSummary(db, runnerId),
    };
    return me;
  });

  // The signed-in Runner's reads today, so the live smoke test can count a search's reads.
  app.get('/api/test/live-reads', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const { readsToday } = await budgetStatus(db, runner.id, new Date());
    const reads: LiveReads = { readsToday };
    return reads;
  });

  // Leaves the signed-in Runner at most `reads` background reads today by raising their daily
  // counter towards the cap, so a live search's burst can't spend more than that. Never lowers it.
  app.post<{ Body: ReadAllowanceBody }>(
    '/api/test/live-read-allowance',
    {
      schema: {
        body: {
          type: 'object',
          required: ['reads'],
          additionalProperties: false,
          properties: { reads: { type: 'integer', minimum: 0, maximum: RUNNER_DAILY_READS } },
        },
      },
    },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const now = new Date();
      const floor = RUNNER_DAILY_READS - request.body.reads;
      await db
        .insert(stravaReadUsage)
        .values({
          window: 'day',
          windowStart: windowStart('day', now),
          runnerId: runner.id,
          reads: floor,
        })
        .onConflictDoUpdate({
          target: [stravaReadUsage.window, stravaReadUsage.windowStart, stravaReadUsage.runnerId],
          set: { reads: sql`greatest(${stravaReadUsage.reads}, ${floor}::int)`, updatedAt: now },
        });
      const { readsToday } = await budgetStatus(db, runner.id, now);
      const reads: LiveReads = { readsToday };
      return reads;
    },
  );

  // Where the Runner's latest run with a route started: a place with Segments they've run.
  app.get('/api/test/live-run-start', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const [run] = await db
      .select({ polyline: activities.summaryPolyline })
      .from(activities)
      .where(
        and(
          eq(activities.runnerId, runner.id),
          isNotNull(activities.summaryPolyline),
          ne(activities.summaryPolyline, ''),
        ),
      )
      .orderBy(desc(activities.startDate))
      .limit(1);
    const start: LiveRunStart | undefined = run?.polyline
      ? decodePolyline(run.polyline)[0]
      : undefined;
    if (!start) return reply.code(404).send({ error: 'no_run_with_a_route' });
    return start;
  });
};
