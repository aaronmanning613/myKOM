import {
  MAPPED_AREA_RADII_KM,
  MAX_SEARCH_AREA_LABEL_LENGTH,
  type MappedArea,
  type MappedAreaCreate,
  type MappedAreasResponse,
} from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import { createMappedArea, deleteMappedArea, listMappedAreas } from './store.js';

export type MappedAreasRoutesOptions = {
  db: Database['db'];
};

const createSchema = {
  type: 'object',
  required: ['label', 'lat', 'lng', 'radiusKm'],
  additionalProperties: false,
  properties: {
    // Must contain something other than whitespace.
    label: { type: 'string', pattern: '\\S', maxLength: MAX_SEARCH_AREA_LABEL_LENGTH },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    radiusKm: { type: 'integer', enum: [...MAPPED_AREA_RADII_KM] },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1, maximum: 2_147_483_647 } },
} as const;

export const mappedAreasRoutes: FastifyPluginAsync<MappedAreasRoutesOptions> = async (
  app,
  { db },
) => {
  app.get('/api/mapped-areas', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const response: MappedAreasResponse = { mappedAreas: await listMappedAreas(db, runner.id) };
    return response;
  });

  // Starts mapping an area in the background. The tick drains its work with spare budget.
  app.post<{ Body: MappedAreaCreate }>(
    '/api/mapped-areas',
    { schema: { body: createSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      const created: MappedArea = await createMappedArea(db, runner.id, {
        ...request.body,
        label: request.body.label.trim(),
      });
      return reply.code(201).send(created);
    },
  );

  // Removes a Mapped Area and stops its pending work.
  app.delete<{ Params: { id: number } }>(
    '/api/mapped-areas/:id',
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const runner = await requireRunner(db, request, reply);
      if (!runner) return reply;
      if (!(await deleteMappedArea(db, runner.id, request.params.id))) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.code(204).send();
    },
  );
};
