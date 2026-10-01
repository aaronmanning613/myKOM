// Test-only routes, so end-to-end tests can sign in without real Strava credentials.
// buildApp registers them only when `testRoutes` is on, which readEnv never allows in production.
import { randomInt } from 'node:crypto';
import { decodePolyline, formatTime, type FitnessProfile, type Me } from '@mykom/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Database } from '../db/client.js';
import { activities, runners, runnerSegments, segments } from '../db/schema.js';
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

/** `sex` is Strava's (unset by default, so the wizard asks for KOM or QOM). */
type TestLoginBody = { firstName?: string; sex?: 'M' | 'F' } | undefined;

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

/**
 * A Known Segment to store as if its details had been read: where it starts, metres, grades in
 * percent (as Strava reports them), the Target Record for both genders and the Runner's PB.
 */
type TestSegment = {
  name: string;
  lat: number;
  lng: number;
  distance: number;
  averageGrade: number;
  maximumGrade?: number;
  totalElevationGain?: number;
  athleteCount: number;
  record: number;
  pb?: number | null;
  /** How long ago the record was read (default 0). */
  recordAgeDays?: number;
  /** The encoded `map.polyline`, stored as is; its last point is the Segment's end. */
  polyline?: string;
};

type TestSegmentsBody = { segments: TestSegment[] };

const testSegmentsSchema = {
  type: 'object',
  required: ['segments'],
  additionalProperties: false,
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'lat', 'lng', 'distance', 'averageGrade', 'athleteCount', 'record'],
        // Rejects unknown fields (a misspelt one would otherwise seed the wrong Segment):
        // Fastify's Ajv silently strips them where this is `false`.
        additionalProperties: { not: {} },
        properties: {
          name: { type: 'string' },
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lng: { type: 'number', minimum: -180, maximum: 180 },
          distance: { type: 'number', exclusiveMinimum: 0 },
          averageGrade: { type: 'number' },
          maximumGrade: { type: 'number' },
          totalElevationGain: { type: 'number', minimum: 0 },
          athleteCount: { type: 'integer', minimum: 0 },
          record: { type: 'integer', minimum: 1 },
          pb: { type: ['integer', 'null'], minimum: 1 },
          recordAgeDays: { type: 'number', minimum: 0 },
          polyline: { type: 'string' },
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
    const sex = request.body?.sex === 'M' || request.body?.sex === 'F' ? request.body.sex : null;
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
          sex,
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
    const me: Me = {
      id: runnerId,
      firstName,
      avatarUrl: null,
      sex,
      recordGender: null,
      onboarded: false,
      suggestion: null,
    };
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

  // Stores Known Segments for the signed-in Runner (run, with details), so e2e can rank a
  // seeded area without Strava.
  app.post<{ Body: TestSegmentsBody }>(
    '/api/test/segments',
    { schema: { body: testSegmentsSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const now = Date.now();
      for (const segment of request.body.segments) {
        const id = randomInt(1, 2 ** 47);
        const record = formatTime(segment.record);
        const end = segment.polyline ? decodePolyline(segment.polyline).at(-1) : undefined;
        await db.insert(segments).values({
          id,
          name: segment.name,
          activityType: 'Run',
          distance: segment.distance,
          averageGrade: segment.averageGrade,
          maximumGrade: segment.maximumGrade ?? Math.max(segment.averageGrade, 0) + 1,
          totalElevationGain: segment.totalElevationGain ?? 0,
          startLat: segment.lat,
          startLng: segment.lng,
          endLat: end?.lat ?? null,
          endLng: end?.lng ?? null,
          polyline: segment.polyline ?? null,
          komSeconds: segment.record,
          qomSeconds: segment.record,
          komRaw: record,
          qomRaw: record,
          komStatus: 'ok',
          qomStatus: 'ok',
          athleteCount: segment.athleteCount,
          detailFetchedAt: new Date(now - (segment.recordAgeDays ?? 0) * DAY_MS),
        });
        await db.insert(runnerSegments).values({
          runnerId: runner.id,
          segmentId: id,
          viaRun: segment.pb != null,
          viaStarred: segment.pb == null,
          effortCount: segment.pb != null ? 1 : 0,
          bestSeconds: segment.pb ?? null,
          bestDate: segment.pb != null ? new Date(now) : null,
        });
      }
      return reply.code(204).send();
    },
  );
};
