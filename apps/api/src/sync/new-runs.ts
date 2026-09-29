// New runs: the visit check, Regenerate from Strava and Resync my runs all read the activity
// list, queue the new runs' details and regenerate the Fitness Profile.
import { NEW_RUN_CHECK_THROTTLE_HOURS } from '@mykom/shared';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { runners } from '../db/schema.js';
import { suggestFitnessProfile } from '../fitness-profile/store.js';
import { enqueueJob } from '../jobs/queue.js';
import { syncActivities, type SyncDeps, type SyncMode, type SyncResult } from './activities.js';

const THROTTLE_MS = NEW_RUN_CHECK_THROTTLE_HOURS * 60 * 60 * 1000;

/**
 * Syncs the activity list and queues each new run's details at new-run priority (their Segments
 * inside saved areas follow at mapping priority, see the activity-detail handler).
 */
export async function syncNewRuns(
  deps: SyncDeps,
  runnerId: number,
  mode: SyncMode,
  now = new Date(),
): Promise<SyncResult> {
  const result = await syncActivities(deps, runnerId, mode, now);
  for (const runId of result.newRunIds) {
    await enqueueJob(
      deps.db,
      { kind: 'activity-detail', target: runId, runnerId, priority: 'new-run' },
      now,
    );
  }
  return result;
}

/**
 * The visit check, on an authenticated request: when the Runner's runs were last checked more
 * than NEW_RUN_CHECK_THROTTLE_HOURS ago (or never), reads the new ones and regenerates the
 * Fitness Profile, which may store a suggestion. Returns whether it ran; overlapping requests
 * run it once.
 */
export async function visitCheck(deps: SyncDeps, runnerId: number, now = new Date()) {
  // Claiming the check up front means concurrent requests of a visit don't all read Strava.
  // TODO(decision): a failed check isn't retried until the throttle has passed again.
  const claimed = await deps.db
    .update(runners)
    .set({ activitiesCheckedAt: now })
    .where(
      and(
        eq(runners.id, runnerId),
        or(
          isNull(runners.activitiesCheckedAt),
          lte(runners.activitiesCheckedAt, new Date(now.getTime() - THROTTLE_MS)),
        ),
      ),
    )
    .returning({ id: runners.id });
  if (claimed.length === 0) return false;
  await syncNewRuns(deps, runnerId, 'new', now);
  await suggestFitnessProfile(deps.db, runnerId, now);
  return true;
}

/**
 * Resync my runs: re-reads the whole activity list (dropping deleted runs and updating edited
 * ones), records when, then handles new runs and suggestions like the visit check.
 */
export async function resyncRuns(deps: SyncDeps, runnerId: number, now = new Date()) {
  const result = await syncNewRuns(deps, runnerId, 'full', now);
  await deps.db.update(runners).set({ resyncedAt: now }).where(eq(runners.id, runnerId));
  await suggestFitnessProfile(deps.db, runnerId, now);
  return result;
}
