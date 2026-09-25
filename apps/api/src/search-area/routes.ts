import {
  MAX_SEARCH_AREA_LABEL_LENGTH,
  SEARCH_RADII_KM,
  type SearchAreaResponse,
  type SearchAreaUpdate,
} from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import { loadSearchArea, saveSearchArea } from './store.js';

export type SearchAreaRoutesOptions = {
  db: Database['db'];
};

const updateSchema = {
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
  { db },
) => {
  app.get('/api/search-area', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const response: SearchAreaResponse = { searchArea: await loadSearchArea(db, runner.id) };
    return response;
  });

  app.put<{ Body: SearchAreaUpdate }>(
    '/api/search-area',
    { schema: { body: updateSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      await saveSearchArea(db, runner.id, { ...request.body, label: request.body.label.trim() });
      const response: SearchAreaResponse = { searchArea: await loadSearchArea(db, runner.id) };
      return response;
    },
  );
};
