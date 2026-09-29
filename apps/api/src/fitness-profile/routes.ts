import {
  BENCHMARK_DISTANCES,
  MAX_BENCHMARK_SECONDS,
  type FitnessProfile,
  type FitnessProfileUpdate,
  type UpdateAllRequest,
} from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import type { StravaClient } from '../strava/client.js';
import { syncActivities } from '../sync/activities.js';
import {
  loadFitnessProfile,
  NoGeneratedValueError,
  regenerateFitnessProfile,
  resetToGenerated,
  saveFitnessProfile,
  updateAllBenchmarks,
} from './store.js';

export type FitnessProfileRoutesOptions = {
  db: Database['db'];
  strava: StravaClient;
};

const distance = { type: 'string', enum: BENCHMARK_DISTANCES.map((d) => d.id) } as const;
const seconds = { type: 'integer', minimum: 1, maximum: MAX_BENCHMARK_SECONDS } as const;

const updateSchema = {
  type: 'object',
  required: ['benchmarks'],
  additionalProperties: false,
  properties: {
    benchmarks: {
      type: 'array',
      maxItems: BENCHMARK_DISTANCES.length,
      items: {
        type: 'object',
        required: ['distance'],
        additionalProperties: false,
        properties: { distance, seconds, useGenerated: { const: true } },
        // A time or `useGenerated`, not both. (Not oneOf of two closed objects: Fastify's Ajv
        // strips unknown properties while trying the first.)
        anyOf: [{ required: ['seconds'] }, { required: ['useGenerated'] }],
        not: { required: ['seconds', 'useGenerated'] },
      },
    },
  },
} as const;

const updateAllSchema = {
  type: 'object',
  required: ['distance', 'seconds'],
  additionalProperties: false,
  properties: { distance, seconds },
} as const;

export const fitnessProfileRoutes: FastifyPluginAsync<FitnessProfileRoutesOptions> = async (
  app,
  { db, strava },
) => {
  app.get('/api/fitness-profile', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
    return profile;
  });

  app.put<{ Body: FitnessProfileUpdate }>(
    '/api/fitness-profile',
    { schema: { body: updateSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const distances = request.body.benchmarks.map((b) => b.distance);
      if (new Set(distances).size !== distances.length) {
        return reply
          .code(400)
          .send({ error: 'invalid_fitness_profile', message: 'Each distance may appear once' });
      }
      try {
        await saveFitnessProfile(db, runner.id, request.body);
      } catch (err) {
        if (!(err instanceof NoGeneratedValueError)) throw err;
        return reply.code(400).send({ error: 'no_generated_value', message: err.message });
      }
      const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
      return profile;
    },
  );

  app.post<{ Body: UpdateAllRequest }>(
    '/api/fitness-profile/update-all',
    { schema: { body: updateAllSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      await updateAllBenchmarks(db, runner.id, request.body);
      const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
      return profile;
    },
  );

  app.post('/api/fitness-profile/reset', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    if (!(await resetToGenerated(db, runner.id))) {
      return reply.code(409).send({
        error: 'no_generated_profile',
        message: 'There is no generated Fitness Profile to reset to',
      });
    }
    const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
    return profile;
  });

  // The Runner asked for it, so it ignores the new-run check's throttle and applies directly.
  app.post('/api/fitness-profile/regenerate', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const now = new Date();
    await syncActivities({ db, strava }, runner.id, 'new', now);
    await regenerateFitnessProfile(db, runner.id, now);
    const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
    return profile;
  });
};
