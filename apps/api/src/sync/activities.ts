// Reading the Runner's runs and starred Segments from Strava. These are interactive calls: they
// go straight through the Strava client (never the job queue), so they can use the reserve.
import { RUN_SPORT_TYPES } from '@mykom/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { activities, runners, segmentEfforts } from '../db/schema.js';
import { regenerateFitnessProfile } from '../fitness-profile/store.js';
import { activityColumns, refreshRunSegments, storeStarredSegments } from '../jobs/handlers.js';
import {
  STRAVA_PAGE_SIZE,
  type StravaActivitySummary,
  type StravaClient,
} from '../strava/client.js';

/**
 * `full` reads the whole activity list and drops stored runs that are gone from it; `new` reads
 * only the runs started after the latest stored one.
 */
export type SyncMode = 'full' | 'new';

export type SyncResult = {
  /** Runs stored for the first time, newest first. */
  newRunIds: number[];
  /** Stored runs that no longer exist on Strava (or are no longer runs); `full` only. */
  removedRunIds: number[];
};

export type SyncDeps = { db: Database['db']; strava: StravaClient };

/** Upserts are split so a Runner with thousands of runs stays under Postgres's parameter limit. */
const UPSERT_CHUNK = 500;

/** The row an upsert tried to insert, so each run gets its own summary. */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

function isRun(activity: StravaActivitySummary): boolean {
  return (RUN_SPORT_TYPES as readonly string[]).includes(activity.sportType);
}

/**
 * Syncs the Runner's stored runs with their Strava activity list, then records the check in
 * `activities_checked_at`. A `full` sync also removes the stored runs that are gone and
 * recomputes the Runner's `runner_segments` from the efforts that remain.
 */
export async function syncActivities(
  { db, strava }: SyncDeps,
  runnerId: number,
  mode: SyncMode,
  now = new Date(),
): Promise<SyncResult> {
  let after: Date | undefined;
  if (mode === 'new') {
    const [latest] = await db
      .select({ startDate: activities.startDate })
      .from(activities)
      .where(eq(activities.runnerId, runnerId))
      .orderBy(desc(activities.startDate))
      .limit(1);
    after = latest?.startDate;
  }

  const runs: StravaActivitySummary[] = [];
  for (let page = 1; ; page++) {
    const { data } = await strava.listActivities(runnerId, { after, page });
    runs.push(...data.filter(isRun));
    if (data.length < STRAVA_PAGE_SIZE) break;
  }

  const stored = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.runnerId, runnerId));
  const storedIds = new Set(stored.map((row) => row.id));
  const fetchedIds = new Set(runs.map((run) => run.id));
  const newRunIds = runs
    .filter((run) => !storedIds.has(run.id))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((run) => run.id);
  const removedRunIds = mode === 'full' ? [...storedIds].filter((id) => !fetchedIds.has(id)) : [];

  await db.transaction(async (tx) => {
    for (let i = 0; i < runs.length; i += UPSERT_CHUNK) {
      const chunk = runs.slice(i, i + UPSERT_CHUNK);
      // An edited run keeps its fetched details (and efforts); only the summary changes.
      await tx
        .insert(activities)
        .values(chunk.map((run) => ({ id: run.id, runnerId, ...activityColumns(run) })))
        .onConflictDoUpdate({
          target: activities.id,
          set: {
            name: excluded('name'),
            sportType: excluded('sport_type'),
            startDate: excluded('start_date'),
            distance: excluded('distance'),
            movingTime: excluded('moving_time'),
            summaryPolyline: excluded('summary_polyline'),
            minLat: excluded('min_lat'),
            minLng: excluded('min_lng'),
            maxLat: excluded('max_lat'),
            maxLng: excluded('max_lng'),
            updatedAt: now,
          },
        });
    }
    if (removedRunIds.length > 0) {
      const touched = await tx
        .selectDistinct({ segmentId: segmentEfforts.segmentId })
        .from(segmentEfforts)
        .where(inArray(segmentEfforts.activityId, removedRunIds));
      // Their efforts go with them (cascade), then the bests are recomputed from what remains.
      await tx
        .delete(activities)
        .where(and(eq(activities.runnerId, runnerId), inArray(activities.id, removedRunIds)));
      await refreshRunSegments(
        tx,
        runnerId,
        touched.map((row) => row.segmentId),
      );
    }
    await tx.update(runners).set({ activitiesCheckedAt: now }).where(eq(runners.id, runnerId));
  });

  return { newRunIds, removedRunIds };
}

/** Reads every page of the Runner's starred Segments and links the running ones as starred. */
export async function syncStarredSegments({ db, strava }: SyncDeps, runnerId: number) {
  for (let page = 1; ; page++) {
    const { data } = await strava.getStarredSegments(runnerId, page);
    await storeStarredSegments(db, runnerId, data);
    if (data.length < STRAVA_PAGE_SIZE) break;
  }
}

/**
 * A Runner's first sync, at their first sign-in: every run, the Fitness Profile generated from
 * them (applied), and their starred Segments. No run details are queued: crawls fetch them.
 */
export async function syncFirstSignIn(deps: SyncDeps, runnerId: number, now = new Date()) {
  await syncActivities(deps, runnerId, 'full', now);
  await regenerateFitnessProfile(deps.db, runnerId, now);
  await syncStarredSegments(deps, runnerId);
}
