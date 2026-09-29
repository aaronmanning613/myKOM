// Test-only routes, so end-to-end tests can sign in without real Strava credentials.
// buildApp registers them only when `testRoutes` is on, which readEnv never allows in production.
import { randomInt } from 'node:crypto';
import type { FitnessProfile, Me } from '@mykom/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { activities, runners } from '../db/schema.js';
import {
  loadFitnessProfile,
  regenerateFitnessProfile,
  suggestFitnessProfile,
} from '../fitness-profile/store.js';
import { STRAVA_SCOPES } from '../strava/client.js';
import type { TokenCipher } from '../strava/token-cipher.js';
import { requireRunner } from './guard.js';
import { upsertRunnerFromStrava } from './runners.js';
import { startSession } from './session.js';

export type TestRoutesOptions = {
  db: Database['db'];
  tokenCipher: TokenCipher;
};

type TestLoginBody = { firstName?: string } | undefined;

/** A run to store as if the activity list had returned it: metres, seconds, days before now. */
type TestRun = { name: string; distance: number; movingTime: number; daysAgo: number };

/**
 * `apply` (the default) applies the generated profile, as a first sign-in's sync does. `suggest`
 * only suggests it, as a new-run check does.
 */
type TestRunsBody = { runs: TestRun[]; profile?: 'apply' | 'suggest' };

const testRunsSchema = {
  type: 'object',
  required: ['runs'],
  additionalProperties: false,
  properties: {
    profile: { type: 'string', enum: ['apply', 'suggest'] },
    runs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'distance', 'movingTime', 'daysAgo'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          distance: { type: 'number', exclusiveMinimum: 0 },
          movingTime: { type: 'integer', minimum: 1 },
          daysAgo: { type: 'number', minimum: 0 },
        },
      },
    },
  },
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

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
    // Like a real sign-in's first sync, but without reading Strava: the visit check leaves the
    // Runner alone until its throttle has passed.
    await db
      .update(runners)
      .set({ activitiesCheckedAt: new Date() })
      .where(eq(runners.id, runnerId));
    startSession(request, reply, runnerId);
    const me: Me = { id: runnerId, firstName, avatarUrl: null, onboarded: false, suggestion: null };
    return me;
  });

  // Stores runs for the signed-in Runner (no polyline, so crawls ignore them) and applies or
  // suggests the Fitness Profile generated from them.
  app.post<{ Body: TestRunsBody }>(
    '/api/test/runs',
    { schema: { body: testRunsSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const now = new Date();
      if (request.body.runs.length) {
        await db.insert(activities).values(
          request.body.runs.map((run) => ({
            id: randomInt(1, 2 ** 47),
            runnerId: runner.id,
            name: run.name,
            sportType: 'Run',
            startDate: new Date(now.getTime() - run.daysAgo * DAY_MS),
            distance: run.distance,
            movingTime: run.movingTime,
          })),
        );
      }
      if (request.body.profile === 'suggest') await suggestFitnessProfile(db, runner.id, now);
      else await regenerateFitnessProfile(db, runner.id, now);
      const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
      return profile;
    },
  );
};
