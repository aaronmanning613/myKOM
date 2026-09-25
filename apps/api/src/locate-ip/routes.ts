import type { LocateIpResponse } from '@mykom/shared';
import type { FastifyPluginAsync } from 'fastify';
import { requireRunner } from '../auth/guard.js';
import type { Database } from '../db/client.js';
import type { IpLocator } from './locator.js';

export type LocateIpRoutesOptions = {
  db: Database['db'];
  /** Undefined when the GeoLite2 City database isn't installed: the lookup is then unavailable. */
  ipLocator?: IpLocator;
};

export const locateIpRoutes: FastifyPluginAsync<LocateIpRoutesOptions> = async (
  app,
  { db, ipLocator },
) => {
  // The fallback when browser geolocation fails. `request.ip` is the real client address when
  // TRUST_PROXY matches the proxies in front of the API.
  app.get('/api/locate-ip', async (request, reply) => {
    const runner = await requireRunner(db, request, reply);
    if (!runner) return reply;
    const location = ipLocator?.locate(request.ip);
    const response: LocateIpResponse = location
      ? { available: true, location }
      : { available: false, reason: ipLocator ? 'not_found' : 'no_database' };
    return response;
  });
};
