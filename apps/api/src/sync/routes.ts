import type { FitnessProfile } from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import { loadFitnessProfile } from '../fitness-profile/store.js';
import type { StravaClient } from '../strava/client.js';
import { resyncRuns } from './new-runs.js';

export type SyncRoutesOptions = {
  db: Database['db'];
  strava: StravaClient;
};

export const syncRoutes: FastifyPluginAsync<SyncRoutesOptions> = async (app, { db, strava }) => {
  // Resync my runs: replies with the Fitness Profile (its resyncedAt and any new suggestion).
  app.post('/api/activities/resync', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    await resyncRuns({ db, strava }, runner.id);
    const profile: FitnessProfile = await loadFitnessProfile(db, runner.id);
    return profile;
  });
};
