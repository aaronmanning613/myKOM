// A search: save the Search Area, rank what's stored, and start gathering what's missing.
import {
  FIRST_BURST_PARALLEL,
  FIRST_BURST_RUNS,
  FIRST_BURST_SEGMENT_DETAILS,
  type Results,
  type SearchAreaUpdate,
} from '@mykom/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { crawls, runners, stravaJobs } from '../db/schema.js';
import { startCrawl } from '../jobs/crawls.js';
import { JOB_PRIORITY, type JobQueue } from '../jobs/queue.js';
import { loadResults } from '../results/load.js';
import { saveSearchArea } from '../search-area/store.js';
import { StravaRevokedError, type StravaClient } from '../strava/client.js';
import { syncStarredSegments } from '../sync/activities.js';

// TODO(decision): the spec says the first burst takes "a few seconds"; this caps it.
/** The first burst stops claiming work after this many seconds. */
export const FIRST_BURST_SECONDS = 10;

export type SearchDeps = {
  db: Database['db'];
  strava: StravaClient;
  queue: JobQueue;
  log: { error: (details: object, message: string) => void };
};

/**
 * Searches an area for the Runner: saves it as their Search Area (and marks them onboarded),
 * refreshes their starred Segments, starts a crawl of the area at search priority, spends the
 * first burst on it, and returns the ranked results.
 */
export async function search(
  { db, strava, queue, log }: SearchDeps,
  runnerId: number,
  area: SearchAreaUpdate,
  now: () => Date = () => new Date(),
): Promise<Results | null> {
  await saveSearchArea(db, runnerId, area);
  await db
    .update(runners)
    .set({ onboardedAt: now() })
    .where(and(eq(runners.id, runnerId), isNull(runners.onboardedAt)));

  try {
    await syncStarredSegments({ db, strava }, runnerId);
  } catch (err) {
    // Revoked: the Runner is gone, and the error handler signs them out. Otherwise the search
    // goes on with the starred Segments already stored.
    if (err instanceof StravaRevokedError) throw err;
    log.error({ err, runnerId }, 'Starred Segments fetch failed');
  }

  await supersedeSearchCrawls(db, runnerId, now());
  await startCrawl(db, { runnerId, area }, now());

  const start = now();
  await queue.drain({
    deadline: new Date(start.getTime() + FIRST_BURST_SECONDS * 1000),
    now,
    strava,
    concurrency: FIRST_BURST_PARALLEL,
    // Only this search's work: not other Runners', nor the Runner's new-run or mapping jobs.
    runnerId,
    minPriority: 'search',
    limits: {
      'activity-detail': FIRST_BURST_RUNS,
      'segment-detail': FIRST_BURST_SEGMENT_DETAILS,
    },
  });

  // Null only when the Runner was deleted during the burst (a job found their access revoked).
  return loadResults(db, runnerId, now());
}

// TODO(decision): the spec doesn't say what happens to the previous search's crawl. A new
// search ends it, and its pending jobs drop to mapping priority: they still land with spare
// budget, but no longer get ahead of the new search's work.
/** Ends the Runner's unfinished search crawls, demoting their pending jobs. */
async function supersedeSearchCrawls(db: Database['db'], runnerId: number, now: Date) {
  await db.transaction(async (tx) => {
    const ended = await tx
      .update(crawls)
      .set({ status: 'done', finishedAt: now })
      .where(
        and(eq(crawls.runnerId, runnerId), isNull(crawls.mappedAreaId), ne(crawls.status, 'done')),
      )
      .returning({ id: crawls.id });
    if (ended.length === 0) return;
    await tx
      .update(stravaJobs)
      .set({ priority: JOB_PRIORITY.mapping })
      .where(
        and(
          inArray(
            stravaJobs.crawlId,
            ended.map((crawl) => crawl.id),
          ),
          eq(stravaJobs.status, 'pending'),
          eq(stravaJobs.priority, JOB_PRIORITY.search),
        ),
      );
  });
}
