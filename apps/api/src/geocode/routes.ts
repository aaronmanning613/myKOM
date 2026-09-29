import { MAX_GEOCODE_QUERY_LENGTH, type GeocodeResponse } from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import { GeocodeError, type NominatimClient } from './nominatim.js';

export type GeocodeRoutesOptions = {
  db: Database['db'];
  /** Undefined when NOMINATIM_USER_AGENT isn't set: place search is then unavailable. */
  nominatim?: NominatimClient;
};

const querystringSchema = {
  type: 'object',
  required: ['q'],
  properties: {
    // Must contain something other than whitespace.
    q: { type: 'string', pattern: '\\S', maxLength: MAX_GEOCODE_QUERY_LENGTH },
  },
} as const;

export const geocodeRoutes: FastifyPluginAsync<GeocodeRoutesOptions> = async (
  app,
  { db, nominatim },
) => {
  // Signed-in only, so the app's shared Nominatim allowance serves Runners setting a Search Area.
  app.get<{ Querystring: { q: string } }>(
    '/api/geocode',
    { schema: { querystring: querystringSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      if (!nominatim) return reply.code(503).send({ error: 'geocode_unavailable' });
      try {
        const response: GeocodeResponse = { results: await nominatim.search(request.query.q) };
        return response;
      } catch (error) {
        if (!(error instanceof GeocodeError)) throw error;
        request.log.warn({ err: error }, 'Place search failed');
        return reply.code(502).send({ error: 'geocode_failed' });
      }
    },
  );
};
