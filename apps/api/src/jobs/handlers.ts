// The Strava job handlers: what each kind of job reads from Strava and stores.
import { recordFor, RECORD_GENDERS } from '@mykom/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { activities, runnerSegments, segmentEfforts, segments } from '../db/schema.js';
import {
  STRAVA_PAGE_SIZE,
  type StravaActivitySummary,
  type StravaSegmentSummary,
} from '../strava/client.js';
import {
  JOB_PRIORITY,
  type Db,
  type Job,
  type JobHandler,
  type JobHandlers,
  type JobPriority,
} from './queue.js';

/** Where handlers write warnings (pino-compatible, e.g. Fastify's `app.log`). */
export type JobLogger = { warn: (details: object, message: string) => void };

/** The handlers for every job kind that reads from Strava. */
export function createStravaJobHandlers({ log }: { log: JobLogger }): JobHandlers {
  return {
    'activity-detail': activityDetail,
    'segment-detail': segmentDetail(log),
    'starred-segments': starredSegments,
  };
}

/** The named priority a job was queued at, so its follow-up work can share it. */
function priorityOf(job: Job): JobPriority {
  const named = (Object.keys(JOB_PRIORITY) as JobPriority[]).find(
    (name) => JOB_PRIORITY[name] === job.priority,
  );
  return named ?? 'freshness';
}

/**
 * A run's DetailedActivity: stores its Segment efforts (their Segments summary-only when new),
 * refreshes the Runner's links to those Segments, and marks the run's details fetched. An
 * effort with a KOM/QOM achievement or a top-10 hint queues that Segment's details at search
 * priority ("I just took it"), so a crown shows on the next results load.
 */
const activityDetail: JobHandler = async (job, { db, strava, now, enqueue }) => {
  const { data: run } = await strava.getActivity(job.runnerId, job.target!);
  const fetchedAt = now();
  await db.transaction(async (tx) => {
    const summary = { ...activityColumns(run), detailFetchedAt: fetchedAt };
    await tx
      .insert(activities)
      .values({ id: run.id, runnerId: job.runnerId, ...summary })
      .onConflictDoUpdate({ target: activities.id, set: summary });
    await insertSummarySegments(
      tx,
      run.efforts.map((effort) => effort.segment),
    );
    // A re-fetch replaces the run's efforts, so an edited run leaves nothing stale behind.
    const removed = await tx
      .delete(segmentEfforts)
      .where(eq(segmentEfforts.activityId, run.id))
      .returning({ segmentId: segmentEfforts.segmentId });
    if (run.efforts.length > 0) {
      await tx.insert(segmentEfforts).values(
        run.efforts.map((effort) => ({
          id: BigInt(effort.id),
          runnerId: job.runnerId,
          activityId: run.id,
          segmentId: effort.segment.id,
          elapsedTime: effort.elapsedTime,
          startDate: new Date(effort.startDate),
          komRank: effort.komRank,
          recordAchievement: effort.recordAchievement,
        })),
      );
    }
    await refreshRunSegments(tx, job.runnerId, [
      ...removed.map((effort) => effort.segmentId),
      ...run.efforts.map((effort) => effort.segment.id),
    ]);
  });
  const hinted = new Set(
    run.efforts
      .filter((effort) => effort.recordAchievement || effort.komRank != null)
      .map((effort) => effort.segment.id),
  );
  for (const segmentId of hinted) {
    await enqueue({
      kind: 'segment-detail',
      target: segmentId,
      runnerId: job.runnerId,
      crawlId: job.crawlId,
      priority: 'search',
    });
  }
};

/**
 * A Segment's details: fills the shared Segment row (Target Records, athlete count, geometry)
 * and takes the Runner's Segment PB from `athlete_segment_stats` when Strava sends one.
 */
function segmentDetail(log: JobLogger): JobHandler {
  return async (job, { db, strava, now }) => {
    const { data: segment } = await strava.getSegment(job.runnerId, job.target!);
    const [kom, qom] = RECORD_GENDERS.map((gender) => {
      const record = recordFor(segment, gender);
      if (record.status === 'unparseable') {
        const raw = gender === 'KOM' ? segment.xoms?.kom : segment.xoms?.qom;
        log.warn({ segmentId: segment.id, gender, raw }, 'Unparseable Target Record');
      }
      return record;
    });
    const details = {
      ...summaryColumns(segment),
      totalElevationGain: segment.totalElevationGain,
      polyline: segment.polyline,
      komSeconds: kom!.status === 'ok' ? kom!.seconds : null,
      qomSeconds: qom!.status === 'ok' ? qom!.seconds : null,
      komRaw: segment.xoms?.kom ?? null,
      qomRaw: segment.xoms?.qom ?? null,
      komStatus: kom!.status,
      qomStatus: qom!.status,
      athleteCount: segment.athleteCount,
      detailFetchedAt: now(),
    };
    await db
      .insert(segments)
      .values({ id: segment.id, ...details })
      .onConflictDoUpdate({ target: segments.id, set: details });
    const prSeconds = segment.athleteStats?.prElapsedTime;
    if (prSeconds != null) {
      // The Segment PB is the faster of this and the fastest fetched effort.
      await db
        .update(runnerSegments)
        .set({ statsPrSeconds: prSeconds })
        .where(
          and(eq(runnerSegments.runnerId, job.runnerId), eq(runnerSegments.segmentId, segment.id)),
        );
    }
  };
}

/**
 * One page of the Runner's starred Segments (the job's target, page 1 when unset): links the
 * running Segments to the Runner as starred, and queues the next page when this one is full.
 */
// TODO(decision): a Segment the Runner has since unstarred keeps its starred link; the spec
// doesn't say, and clearing it would need every page read first.
const starredSegments: JobHandler = async (job, { db, strava, enqueue }) => {
  const page = job.target ?? 1;
  const { data } = await strava.getStarredSegments(job.runnerId, page);
  await storeStarredSegments(db, job.runnerId, data);
  if (data.length === STRAVA_PAGE_SIZE) {
    await enqueue({
      kind: 'starred-segments',
      target: page + 1,
      runnerId: job.runnerId,
      crawlId: job.crawlId,
      priority: priorityOf(job),
    });
  }
};

/**
 * Links the running Segments among a page of starred Segments to the Runner as starred,
 * storing new ones summary-only.
 */
export async function storeStarredSegments(
  db: Db,
  runnerId: number,
  starred: StravaSegmentSummary[],
) {
  const running = starred.filter((segment) => segment.activityType === 'Run');
  if (running.length === 0) return;
  await db.transaction(async (tx) => {
    await insertSummarySegments(tx, running);
    await tx
      .insert(runnerSegments)
      .values(running.map((segment) => ({ runnerId, segmentId: segment.id, viaStarred: true })))
      .onConflictDoUpdate({
        target: [runnerSegments.runnerId, runnerSegments.segmentId],
        set: { viaStarred: true },
      });
  });
}

/** A run summary's `activities` columns: everything but the Runner and the detail state. */
export function activityColumns(run: StravaActivitySummary) {
  return {
    name: run.name,
    sportType: run.sportType,
    startDate: new Date(run.startDate),
    distance: run.distance,
    movingTime: run.movingTime,
    summaryPolyline: run.summaryPolyline,
    minLat: run.bbox?.minLat ?? null,
    minLng: run.bbox?.minLng ?? null,
    maxLat: run.bbox?.maxLat ?? null,
    maxLng: run.bbox?.maxLng ?? null,
  };
}

function summaryColumns(segment: StravaSegmentSummary) {
  return {
    name: segment.name,
    activityType: segment.activityType,
    distance: segment.distance,
    averageGrade: segment.averageGrade,
    maximumGrade: segment.maximumGrade,
    elevationHigh: segment.elevationHigh,
    elevationLow: segment.elevationLow,
    startLat: segment.start.lat,
    startLng: segment.start.lng,
    endLat: segment.end?.lat ?? null,
    endLng: segment.end?.lng ?? null,
    hazardous: segment.hazardous,
  };
}

/**
 * Stores Segments seen only as summaries (`detail_fetched_at` null). A Segment already stored
 * is left alone: its details, once fetched, are fuller than any summary.
 */
async function insertSummarySegments(db: Db, summaries: StravaSegmentSummary[]) {
  if (summaries.length === 0) return;
  await db
    .insert(segments)
    .values(summaries.map((segment) => ({ id: segment.id, ...summaryColumns(segment) })))
    .onConflictDoNothing();
}

/**
 * Recomputes the Runner's run links to the given Segments from their stored efforts: effort
 * count, fastest effort and its date, and the top-10 hint. A Segment with no efforts left
 * loses its run link, and the link goes altogether unless it's also starred.
 */
export async function refreshRunSegments(db: Db, runnerId: number, segmentIds: number[]) {
  const ids = [...new Set(segmentIds)];
  if (ids.length === 0) return;
  await db.execute(sql`
    insert into ${runnerSegments}
      (runner_id, segment_id, via_run, effort_count, best_seconds, best_date, top_ten_hint)
    select runner_id, segment_id, true, count(*), min(elapsed_time),
      (array_agg(start_date order by elapsed_time, start_date))[1],
      bool_or(kom_rank is not null or record_achievement)
    from ${segmentEfforts}
    where runner_id = ${runnerId} and segment_id in ${ids}
    group by runner_id, segment_id
    on conflict (runner_id, segment_id) do update set
      via_run = true,
      effort_count = excluded.effort_count,
      best_seconds = excluded.best_seconds,
      best_date = excluded.best_date,
      top_ten_hint = excluded.top_ten_hint,
      updated_at = now()`);
  const withoutEfforts = and(
    eq(runnerSegments.runnerId, runnerId),
    inArray(runnerSegments.segmentId, ids),
    notExists(
      db
        .select({ one: sql`1` })
        .from(segmentEfforts)
        .where(
          and(
            eq(segmentEfforts.runnerId, runnerSegments.runnerId),
            eq(segmentEfforts.segmentId, runnerSegments.segmentId),
          ),
        ),
    ),
  );
  await db.delete(runnerSegments).where(and(withoutEfforts, eq(runnerSegments.viaStarred, false)));
  await db
    .update(runnerSegments)
    .set({ viaRun: false, effortCount: 0, bestSeconds: null, bestDate: null, topTenHint: false })
    .where(withoutEfforts);
}
