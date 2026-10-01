import { RECORD_GENDERS, type Preferences } from '@mykom/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import { runners } from '../db/schema.js';

export type PreferencesRoutesOptions = {
  db: Database['db'];
};

const preferencesSchema = {
  type: 'object',
  required: ['recordGender'],
  additionalProperties: false,
  properties: { recordGender: { type: 'string', enum: [...RECORD_GENDERS] } },
} as const;

export const preferencesRoutes: FastifyPluginAsync<PreferencesRoutesOptions> = async (
  app,
  { db },
) => {
  // KOM or QOM, used when the Runner's Strava `sex` is unset.
  app.put<{ Body: Preferences }>(
    '/api/preferences',
    { schema: { body: preferencesSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const { recordGender } = request.body;
      await db
        .update(runners)
        .set({ recordGender, updatedAt: new Date() })
        .where(eq(runners.id, runner.id));
      const preferences: Preferences = { recordGender };
      return preferences;
    },
  );
};
