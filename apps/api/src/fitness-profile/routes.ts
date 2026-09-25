import {
  BENCHMARK_DISTANCES,
  MAX_BENCHMARK_SECONDS,
  type FitnessProfile,
  type FitnessProfileUpdate,
} from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import { loadFitnessProfile, saveFitnessProfile } from './store.js';

export type FitnessProfileRoutesOptions = {
  db: Database['db'];
};

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
        required: ['distance', 'seconds'],
        additionalProperties: false,
        properties: {
          distance: { type: 'string', enum: BENCHMARK_DISTANCES.map((d) => d.id) },
          seconds: { type: 'integer', minimum: 1, maximum: MAX_BENCHMARK_SECONDS },
        },
      },
    },
  },
} as const;

export const fitnessProfileRoutes: FastifyPluginAsync<FitnessProfileRoutesOptions> = async (
  app,
  { db },
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
      await saveFitnessProfile(db, runner.id, request.body);
      const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
      return profile;
    },
  );
};
