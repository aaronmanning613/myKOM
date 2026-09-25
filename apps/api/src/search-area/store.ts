import { isSearchRadiusKm, type SearchArea, type SearchAreaUpdate } from '@mykom/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { searchAreas } from '../db/schema.js';

type Db = Database['db'];

/** The Runner's Search Area, or null if they haven't saved one. */
export async function loadSearchArea(db: Db, runnerId: number): Promise<SearchArea | null> {
  const [row] = await db.select().from(searchAreas).where(eq(searchAreas.runnerId, runnerId));
  // A radius dropped from SEARCH_RADII_KM since it was saved counts as no Search Area,
  // so the Runner is asked to pick again.
  if (!row || !isSearchRadiusKm(row.radiusKm)) return null;
  const { label, lat, lng, radiusKm } = row;
  return { label, lat, lng, radiusKm };
}

/** Replaces the Runner's Search Area. */
export async function saveSearchArea(
  db: Db,
  runnerId: number,
  update: SearchAreaUpdate,
): Promise<void> {
  const { label, lat, lng, radiusKm } = update;
  const values = { label, lat, lng, radiusKm };
  await db
    .insert(searchAreas)
    .values({ runnerId, ...values })
    .onConflictDoUpdate({ target: searchAreas.runnerId, set: values });
}
