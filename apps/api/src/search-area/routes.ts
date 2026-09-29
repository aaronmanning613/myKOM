import {
  MAX_SEARCH_AREA_LABEL_LENGTH,
  SEARCH_RADII_KM,
  type Results,
  type SearchAreaResponse,
  type SearchAreaUpdate,
} from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import { endSession } from '../auth/session.js';
import type { Database } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import { search } from '../search/search.js';
import type { StravaClient } from '../strava/client.js';
import { loadSearchArea } from './store.js';

export type SearchAreaRoutesOptions = {
  db: Database['db'];
  strava: StravaClient;
  queue: JobQueue;
};

const searchSchema = {
  type: 'object',
  required: ['label', 'lat', 'lng', 'radiusKm'],
  additionalProperties: false,
  properties: {
    // Must contain something other than whitespace.
    label: { type: 'string', pattern: '\\S', maxLength: MAX_SEARCH_AREA_LABEL_LENGTH },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    radiusKm: { type: 'integer', enum: [...SEARCH_RADII_KM] },
  },
} as const;

export const searchAreaRoutes: FastifyPluginAsync<SearchAreaRoutesOptions> = async (
  app,
  { db, strava, queue },
) => {
  app.get('/api/search-area', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const response: SearchAreaResponse = { searchArea: await loadSearchArea(db, runner.id) };
    return response;
  });

  // Saves the Search Area, starts gathering its Known Segments, and returns the first results.
  app.post<{ Body: SearchAreaUpdate }>(
    '/api/search',
    { schema: { body: searchSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const results: Results | null = await search(
        { db, strava, queue, log: request.log },
        runner.id,
        { ...request.body, label: request.body.label.trim() },
      );
      if (!results) {
        // Deleted during the search: a job found their Strava access revoked.
        endSession(request, reply);
        return reply.code(401).send({ error: 'signed_out' });
      }
      return results;
    },
  );
};
