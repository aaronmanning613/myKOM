import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { geocodeCache } from '../db/schema.js';
import type { GeocodeCache } from './nominatim.js';

/** Keeps Nominatim results in the `geocode_cache` table. */
// TODO(decision): entries never expire. Add a max age if stale place data becomes a problem.
export function createDbGeocodeCache(db: Database['db']): GeocodeCache {
  return {
    async get(query) {
      const [row] = await db
        .select({ results: geocodeCache.results })
        .from(geocodeCache)
        .where(eq(geocodeCache.query, query))
        .limit(1);
      return row?.results;
    },
    async set(query, results) {
      await db
        .insert(geocodeCache)
        .values({ query, results })
        .onConflictDoUpdate({ target: geocodeCache.query, set: { results } });
    },
  };
}
