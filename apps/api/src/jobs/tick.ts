// The tick: Cloud Scheduler (or the dev server's interval) drains mapping and freshness work,
// and once a day runs housekeeping.
import { FIRST_BURST_PARALLEL, FRESHNESS_AGE_DAYS, TICK_DRAIN_SECONDS } from '@mykom/shared';
import { and, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appState, stravaJobs, stravaReadUsage } from '../db/schema.js';
import type { StravaClient } from '../strava/client.js';
import { windowStart } from './budget.js';
import { enqueueJob, type DrainResult, type JobQueue } from './queue.js';

type Db = Database['db'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The app_state key holding when housekeeping last ran. */
export const HOUSEKEEPING_KEY = 'housekeeping';

// TODO(decision): the spec doesn't say how long finished jobs and usage rows are kept, or how
// many freshness re-fetches one housekeeping run queues.
/** Done and failed jobs are pruned this long after they finished. */
export const FINISHED_JOB_RETENTION_MS = 7 * DAY_MS;
/** Read-usage rows are pruned once their window started before yesterday (UTC). */
export const USAGE_RETENTION_DAYS = 1;
/** At most this many freshness re-fetches are queued per housekeeping run. */
export const FRESHNESS_BATCH = 500;

export type HousekeepingResult = {
  freshnessQueued: number;
  jobsPruned: number;
  usagePruned: number;
};

export type TickResult = {
  /** Null when housekeeping had already run today. */
  housekeeping: HousekeepingResult | null;
  drain: DrainResult;
};

/**
 * The tick: housekeeping when it's due (at most once per UTC day, tracked in app_state), then a
 * drain of up to TICK_DRAIN_SECONDS. Overlapping ticks are safe: only one claims housekeeping,
 * and drains never share a job.
 */
export function createTick({
  db,
  queue,
  strava,
}: {
  db: Db;
  queue: Pick<JobQueue, 'drain'>;
  strava: StravaClient;
}) {
  return async function tick(now: () => Date = () => new Date()): Promise<TickResult> {
    const housekeeping = (await claimHousekeeping(db, now()))
      ? await runHousekeeping(db, now())
      : null;
    const deadline = new Date(now().getTime() + TICK_DRAIN_SECONDS * 1000);
    const drain = await queue.drain({ deadline, now, strava, concurrency: FIRST_BURST_PARALLEL });
    return { housekeeping, drain };
  };
}

export type Tick = ReturnType<typeof createTick>;

/**
 * Records that housekeeping runs now, if it hasn't run yet today (UTC). True for the one caller
 * that should run it.
 */
async function claimHousekeeping(db: Db, now: Date): Promise<boolean> {
  const today = windowStart('day', now).toISOString();
  const rows = await db.execute(sql`
    insert into ${appState} (key, value)
    values (${HOUSEKEEPING_KEY}, jsonb_build_object('lastRanAt', ${now.toISOString()}::text))
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where (${appState}.value->>'lastRanAt')::timestamptz < ${today}::timestamptz
    returning key`);
  return rows.length > 0;
}

/** Queues the freshness re-fetches, then prunes finished jobs and old read-usage rows. */
export async function runHousekeeping(db: Db, now: Date): Promise<HousekeepingResult> {
  const freshnessQueued = await queueFreshness(db, now);
  const pruned = await db
    .delete(stravaJobs)
    .where(
      and(
        inArray(stravaJobs.status, ['done', 'failed']),
        lt(stravaJobs.finishedAt, new Date(now.getTime() - FINISHED_JOB_RETENTION_MS)),
      ),
    )
    .returning({ id: stravaJobs.id });
  const keepFrom = new Date(windowStart('day', now).getTime() - USAGE_RETENTION_DAYS * DAY_MS);
  const usage = await db
    .delete(stravaReadUsage)
    .where(lt(stravaReadUsage.windowStart, keepFrom))
    .returning({ id: stravaReadUsage.id });
  return { freshnessQueued, jobsPruned: pruned.length, usagePruned: usage.length };
}

/**
 * Queues re-fetches, at freshness priority, of Segment details older than FRESHNESS_AGE_DAYS
 * that some Runner knows: those starting in a Search Area first (the most recently searched
 * first), then the rest, oldest first within each. Each is fetched with the token of a Runner
 * who knows it (one whose Search Area it's in, when there is one). Segments that already have
 * a detail job waiting are left alone.
 */
async function queueFreshness(db: Db, now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - FRESHNESS_AGE_DAYS * DAY_MS).toISOString();
  const rows = await db.execute<{ segment_id: number; runner_id: number }>(sql`
    select segment_id, runner_id from (
      select distinct on (s.id) s.id as segment_id, rs.runner_id, s.detail_fetched_at,
        sa.updated_at as searched_at
      from segments s
      join runner_segments rs on rs.segment_id = s.id
      left join search_areas sa on sa.runner_id = rs.runner_id
        and 6371 * 2 * asin(sqrt(
          power(sin(radians(s.start_lat - sa.lat) / 2), 2)
          + cos(radians(sa.lat)) * cos(radians(s.start_lat))
            * power(sin(radians(s.start_lng - sa.lng) / 2), 2)
        )) <= sa.radius_km
      where s.detail_fetched_at < ${staleBefore}::timestamptz
        and not exists (
          select 1 from strava_jobs j
          where j.kind = 'segment-detail' and j.target = s.id
            and j.status in ('pending', 'running'))
      order by s.id, sa.updated_at desc nulls last, rs.runner_id
    ) stale
    order by searched_at desc nulls last, detail_fetched_at, segment_id
    limit ${FRESHNESS_BATCH}`);
  // Jobs of equal priority run oldest first, so queueing in this order is the fetch order.
  for (const row of rows) {
    await enqueueJob(
      db,
      {
        kind: 'segment-detail',
        target: Number(row.segment_id),
        runnerId: row.runner_id,
        priority: 'freshness',
      },
      now,
    );
  }
  return rows.length;
}
