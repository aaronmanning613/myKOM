// Mapped Areas: started, listed with their crawl's progress, and removed.
import type { MappedArea, MappedAreaCreate, MappedAreaRadiusKm } from '@mykom/shared';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { crawls, mappedAreas, stravaJobs } from '../db/schema.js';
import { startCrawl } from '../jobs/crawls.js';
import { JOB_PRIORITY } from '../jobs/queue.js';

type Db = Database['db'];

/**
 * Saves a Mapped Area and starts its crawl, which queues the area's runs at mapping priority
 * for the tick to drain with spare budget. Reads nothing from Strava itself.
 */
export async function createMappedArea(
  db: Db,
  runnerId: number,
  area: MappedAreaCreate,
  now = new Date(),
): Promise<MappedArea> {
  const [row] = await db
    .insert(mappedAreas)
    .values({ runnerId, ...area })
    .returning({ id: mappedAreas.id });
  await startCrawl(db, { runnerId, area, mappedAreaId: row!.id }, now);
  const [created] = await listMappedAreas(db, runnerId, row!.id);
  return created!;
}

/** The Runner's Mapped Areas (or just one), newest first, with their crawl's progress. */
export async function listMappedAreas(
  db: Db,
  runnerId: number,
  id?: number,
): Promise<MappedArea[]> {
  const rows = await db
    .select({ area: mappedAreas, crawl: crawls })
    .from(mappedAreas)
    .leftJoin(crawls, eq(crawls.mappedAreaId, mappedAreas.id))
    .where(
      and(
        eq(mappedAreas.runnerId, runnerId),
        id === undefined ? undefined : eq(mappedAreas.id, id),
      ),
    )
    .orderBy(desc(mappedAreas.id));
  return rows.map(({ area, crawl }) => ({
    id: area.id,
    label: area.label,
    lat: area.lat,
    lng: area.lng,
    radiusKm: area.radiusKm as MappedAreaRadiusKm,
    createdAt: area.createdAt.toISOString(),
    progress: {
      status: crawl && crawl.status !== 'done' ? 'running' : 'done',
      runsChecked: crawl?.runsChecked ?? 0,
      runsTotal: crawl?.runsTotal ?? 0,
      segmentsChecked: crawl?.segmentsChecked ?? 0,
      segmentsTotal: crawl?.segmentsTotal ?? 0,
      segmentsFound: crawl?.segmentsFound ?? 0,
      coverage: crawl?.coverage ?? 1,
    },
  }));
}

// TODO(decision): the spec says only that removing stops a Mapped Area. Jobs shared with other
// work are kept so a search or new run isn't left waiting on a deleted job.
/**
 * Removes one of the Runner's Mapped Areas and stops its crawl: its pending mapping jobs are
 * deleted. A job the crawl shares with other work (a search or a new run raised it above
 * mapping priority through de-duplication) or that is running now is kept, unlinked. Returns
 * false when the Runner has no such Mapped Area.
 */
export async function deleteMappedArea(db: Db, runnerId: number, id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [area] = await tx
      .select({ id: mappedAreas.id })
      .from(mappedAreas)
      .where(and(eq(mappedAreas.id, id), eq(mappedAreas.runnerId, runnerId)))
      .for('update');
    if (!area) return false;
    const crawlIds = (
      await tx.select({ id: crawls.id }).from(crawls).where(eq(crawls.mappedAreaId, id))
    ).map((crawl) => crawl.id);
    if (crawlIds.length > 0) {
      const ofCrawl = inArray(stravaJobs.crawlId, crawlIds);
      await tx
        .delete(stravaJobs)
        .where(
          and(
            ofCrawl,
            eq(stravaJobs.status, 'pending'),
            lte(stravaJobs.priority, JOB_PRIORITY.mapping),
          ),
        );
      // The rest would otherwise go with the crawl (the foreign key cascades).
      await tx.update(stravaJobs).set({ crawlId: null }).where(ofCrawl);
    }
    await tx.delete(mappedAreas).where(eq(mappedAreas.id, id));
    return true;
  });
}
