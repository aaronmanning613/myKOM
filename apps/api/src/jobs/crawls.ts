// Known Segment gathering: a crawl fetches the Runner's runs through an area, the run adding
// the most new ground first, and queues the details of the Known Segments that are missing.
import {
  COVERAGE_CELL_M,
  decodePolyline,
  distanceKm,
  FIRST_BURST_PARALLEL,
  SEARCH_STOP_COVERAGE,
  STOP_RULE_MIN_NEW_SEGMENTS,
  STOP_RULE_RECENT_RUNS,
  type LatLng,
} from '@mykom/shared';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  activities,
  crawlRuns,
  crawls,
  runnerSegments,
  segmentEfforts,
  segments,
  stravaJobs,
} from '../db/schema.js';
import { enqueueJob, type Db, type JobFinishedHook, type JobPriority } from './queue.js';

export type Crawl = typeof crawls.$inferSelect;

/** A centre and radius: a Search Area or a Mapped Area. */
export type CrawlArea = { lat: number; lng: number; radiusKm: number };

/**
 * How many of a crawl's runs are queued at once. Runs are queued a few at a time, so the stop
 * rules can end the crawl without wasting reads on runs already queued, and Segment details
 * queued as runs land get their turn between runs.
 */
export const CRAWL_RUNS_AHEAD = FIRST_BURST_PARALLEL;

/**
 * Starts a crawl of the area for the Runner: plans the runs through it whose details are
 * missing (most new ground first, newest first on ties), then queues the first few runs and
 * the missing Segment details. A Mapped Area's crawl runs at mapping priority to 100%
 * coverage; a search's at search priority until a stop rule ends it. Returns the crawl's id.
 */
export async function startCrawl(
  db: Db,
  {
    runnerId,
    area,
    mappedAreaId = null,
  }: { runnerId: number; area: CrawlArea; mappedAreaId?: number | null },
  now = new Date(),
): Promise<number> {
  const plan = planRuns(await runsThrough(db, runnerId, area));
  return db.transaction(async (tx) => {
    const [crawl] = await tx
      .insert(crawls)
      .values({
        runnerId,
        mappedAreaId,
        lat: area.lat,
        lng: area.lng,
        radiusKm: area.radiusKm,
        runsTotal: plan.runs.length,
        cellsTotal: plan.cellsTotal,
        cellsCovered: plan.cellsCovered,
        coverage: coverageOf(plan.cellsCovered, plan.cellsTotal),
      })
      .returning();
    const rows = plan.runs.map((run, position) => ({
      crawlId: crawl!.id,
      activityId: run.id,
      position,
      newCells: run.newCells,
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(crawlRuns).values(rows.slice(i, i + 1000));
    }
    await advance(tx, crawl!, now);
    return crawl!.id;
  });
}

/**
 * Keeps the Runner's crawls going as their jobs finish: a run whose details landed counts as
 * checked (and may trigger a stop rule), and each unfinished crawl queues its next runs and
 * any newly Known Segments' details, and finishes when nothing is left.
 */
export const onCrawlJobFinished: JobFinishedHook = async (job, outcome, { db, now }) => {
  const open = await db
    .select({ id: crawls.id })
    .from(crawls)
    .where(and(eq(crawls.runnerId, job.runnerId), ne(crawls.status, 'done')))
    .orderBy(asc(crawls.id));
  for (const { id } of open) {
    await db.transaction(async (tx) => {
      const crawl = await lockCrawl(tx, id);
      if (!crawl || crawl.status === 'done') return;
      const current =
        job.kind === 'activity-detail' && outcome === 'done'
          ? await checkRun(tx, crawl, job.target!, now())
          : crawl;
      await advance(tx, current, now());
    });
  }
};

async function lockCrawl(db: Db, id: number): Promise<Crawl | undefined> {
  // NO KEY UPDATE, so jobs referencing the crawl can still be inserted while it's held.
  const [crawl] = await db.select().from(crawls).where(eq(crawls.id, id)).for('no key update');
  return crawl;
}

const priorityOf = (crawl: Crawl): JobPriority => (crawl.mappedAreaId ? 'mapping' : 'search');

/**
 * Records that one of the crawl's planned runs has its details: the ground it covers and the
 * new Segments it added in the area. Then applies the stop rules (a search only; a Mapped Area
 * goes on to 100% coverage).
 */
async function checkRun(db: Db, crawl: Crawl, activityId: number, now: Date): Promise<Crawl> {
  const [run] = await db
    .update(crawlRuns)
    .set({ checkedAt: now })
    .where(
      and(
        eq(crawlRuns.crawlId, crawl.id),
        eq(crawlRuns.activityId, activityId),
        isNull(crawlRuns.checkedAt),
      ),
    )
    .returning();
  if (!run) return crawl;
  const newSegments = (await newSegmentsOf(db, crawl.runnerId, activityId)).filter((start) =>
    inArea(start, crawl),
  ).length;
  await db
    .update(crawlRuns)
    .set({ newSegments })
    .where(and(eq(crawlRuns.crawlId, crawl.id), eq(crawlRuns.activityId, activityId)));
  // The runs' new cells are counted in plan order, so they're exact when runs land in order
  // and close enough for progress and the stop rule when they overlap.
  const cellsCovered = Math.min(crawl.cellsTotal, crawl.cellsCovered + run.newCells);
  const recentNewSegments = [...crawl.recentNewSegments, newSegments];
  const coverage = coverageOf(cellsCovered, crawl.cellsTotal);
  const stopReason = crawl.runsFinishedAt
    ? null
    : searchStopReason(crawl, coverage, recentNewSegments);
  const [updated] = await db
    .update(crawls)
    .set({
      runsChecked: crawl.runsChecked + 1,
      cellsCovered,
      coverage,
      recentNewSegments,
      segmentsFound: crawl.segmentsFound + newSegments,
      ...(stopReason ? { runsFinishedAt: now, stopReason } : {}),
    })
    .where(eq(crawls.id, crawl.id))
    .returning();
  return updated!;
}

function searchStopReason(
  crawl: Crawl,
  coverage: number,
  recentNewSegments: number[],
): Crawl['stopReason'] {
  if (crawl.mappedAreaId) return null;
  if (coverage >= SEARCH_STOP_COVERAGE) return 'coverage';
  const lastRuns = recentNewSegments.slice(-STOP_RULE_RECENT_RUNS);
  const added = lastRuns.reduce((sum, n) => sum + n, 0);
  if (lastRuns.length === STOP_RULE_RECENT_RUNS && added < STOP_RULE_MIN_NEW_SEGMENTS) {
    return 'few-new-segments';
  }
  return null;
}

/**
 * The start points of the Segments the run added to the Runner's Known Segments: none of
 * their other runs has an effort on them, and they aren't starred.
 */
async function newSegmentsOf(db: Db, runnerId: number, activityId: number): Promise<LatLng[]> {
  const others = db
    .select({ one: sql`1` })
    .from(sql`${segmentEfforts} as other`)
    .where(
      sql`other.runner_id = ${runnerId} and other.segment_id = ${segmentEfforts.segmentId}
        and other.activity_id <> ${activityId}`,
    );
  return db
    .selectDistinct({ id: segments.id, lat: segments.startLat, lng: segments.startLng })
    .from(segmentEfforts)
    .innerJoin(segments, eq(segments.id, segmentEfforts.segmentId))
    .innerJoin(
      runnerSegments,
      and(
        eq(runnerSegments.runnerId, segmentEfforts.runnerId),
        eq(runnerSegments.segmentId, segmentEfforts.segmentId),
      ),
    )
    .where(
      and(
        eq(segmentEfforts.runnerId, runnerId),
        eq(segmentEfforts.activityId, activityId),
        eq(runnerSegments.viaStarred, false),
        sql`not exists ${others}`,
      ),
    );
}

/**
 * Queues the crawl's next runs (keeping CRAWL_RUNS_AHEAD in flight) and the missing Segment
 * details, updates its progress, and finishes it once no work is left.
 */
async function advance(db: Db, crawl: Crawl, now: Date): Promise<void> {
  const priority = priorityOf(crawl);
  let runsFinishedAt = crawl.runsFinishedAt;
  let stopReason = crawl.stopReason;
  // Runs queued before a stop rule ended the crawl still land and count.
  const inFlight = await runsInFlight(db, crawl);
  if (!runsFinishedAt) {
    const next = await db
      .select({ activityId: crawlRuns.activityId })
      .from(crawlRuns)
      .where(
        and(
          eq(crawlRuns.crawlId, crawl.id),
          isNull(crawlRuns.queuedAt),
          isNull(crawlRuns.checkedAt),
        ),
      )
      .orderBy(asc(crawlRuns.position))
      .limit(Math.max(0, CRAWL_RUNS_AHEAD - inFlight));
    for (const { activityId } of next) {
      await enqueueJob(
        db,
        {
          kind: 'activity-detail',
          target: activityId,
          runnerId: crawl.runnerId,
          crawlId: crawl.id,
          priority,
        },
        now,
      );
    }
    if (next.length > 0) {
      await db
        .update(crawlRuns)
        .set({ queuedAt: now })
        .where(
          and(
            eq(crawlRuns.crawlId, crawl.id),
            inArray(
              crawlRuns.activityId,
              next.map((run) => run.activityId),
            ),
          ),
        );
    } else if (inFlight === 0) {
      // Every planned run has been checked (or has failed for good).
      runsFinishedAt = now;
      stopReason = 'all-runs';
    }
  }
  const details = await queueMissingDetails(db, crawl, priority, now);
  const done = runsFinishedAt !== null && inFlight === 0 && details.inFlight === 0;
  await db
    .update(crawls)
    .set({
      runsFinishedAt,
      stopReason,
      segmentsTotal: details.known,
      segmentsChecked: details.checked,
      ...(done ? { status: 'done' as const, finishedAt: now } : {}),
    })
    .where(eq(crawls.id, crawl.id));
}

/**
 * The crawl's queued runs not yet checked whose detail job is still pending or running, or
 * has just succeeded (its job is marked done a moment before this crawl hears about it).
 */
async function runsInFlight(db: Db, crawl: Crawl): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(crawlRuns)
    .innerJoin(activities, eq(activities.id, crawlRuns.activityId))
    .where(
      and(
        eq(crawlRuns.crawlId, crawl.id),
        isNotNull(crawlRuns.queuedAt),
        isNull(crawlRuns.checkedAt),
        or(
          isNotNull(activities.detailFetchedAt),
          liveJob('activity-detail', crawl.runnerId, crawlRuns.activityId),
        ),
      ),
    );
  return row!.count;
}

/** A pending or running job of the kind for the Runner and target exists. */
function liveJob(
  kind: 'activity-detail' | 'segment-detail',
  runnerId: number,
  target: typeof crawlRuns.activityId | typeof segments.id,
) {
  return sql`exists (select 1 from ${stravaJobs} where ${stravaJobs.kind} = ${kind}
    and ${stravaJobs.runnerId} = ${runnerId} and ${stravaJobs.target} = ${target}
    and ${stravaJobs.status} in ('pending', 'running'))`;
}

/**
 * Queues the details of the Runner's Known Segments in the area that have none (and no job
 * pending, running or failed for good), in the spec's order: top-10/KOM hints first, then the
 * most run, then the nearest the centre. Returns the area's Known Segment counts and how many
 * details are still to come.
 */
async function queueMissingDetails(db: Db, crawl: Crawl, priority: JobPriority, now: Date) {
  const box = boxAround(crawl);
  const rows = await db
    .select({
      id: segments.id,
      lat: segments.startLat,
      lng: segments.startLng,
      detailFetchedAt: segments.detailFetchedAt,
      topTenHint: runnerSegments.topTenHint,
      effortCount: runnerSegments.effortCount,
      job: sql<string | null>`(select ${stravaJobs.status} from ${stravaJobs}
        where ${stravaJobs.kind} = 'segment-detail' and ${stravaJobs.runnerId} = ${crawl.runnerId}
          and ${stravaJobs.target} = ${segments.id}
          and ${stravaJobs.status} in ('pending', 'running', 'failed')
        order by ${stravaJobs.status} = 'failed' limit 1)`,
    })
    .from(runnerSegments)
    .innerJoin(segments, eq(segments.id, runnerSegments.segmentId))
    .where(
      and(
        eq(runnerSegments.runnerId, crawl.runnerId),
        gte(segments.startLat, box.minLat),
        lte(segments.startLat, box.maxLat),
        gte(segments.startLng, box.minLng),
        lte(segments.startLng, box.maxLng),
      ),
    );
  const known = rows
    .map((row) => ({ ...row, km: distanceKm(crawl, row) }))
    .filter((row) => row.km <= crawl.radiusKm);
  const missing = known.filter((row) => row.detailFetchedAt === null);
  const toQueue = missing
    .filter((row) => row.job === null)
    .sort(
      (a, b) =>
        Number(b.topTenHint) - Number(a.topTenHint) ||
        b.effortCount - a.effortCount ||
        a.km - b.km ||
        a.id - b.id,
    );
  for (const segment of toQueue) {
    await enqueueJob(
      db,
      {
        kind: 'segment-detail',
        target: segment.id,
        runnerId: crawl.runnerId,
        crawlId: crawl.id,
        priority,
      },
      now,
    );
  }
  return {
    known: known.length,
    checked: known.length - missing.length,
    inFlight: missing.filter((row) => row.job !== 'failed').length,
  };
}

type CandidateRun = {
  id: number;
  startDate: Date;
  fetched: boolean;
  cells: Set<number>;
};

/** The Runner's stored runs whose polyline passes through the area, with the cells they cross. */
async function runsThrough(db: Db, runnerId: number, area: CrawlArea): Promise<CandidateRun[]> {
  const box = boxAround(area);
  const rows = await db
    .select({
      id: activities.id,
      startDate: activities.startDate,
      polyline: activities.summaryPolyline,
      detailFetchedAt: activities.detailFetchedAt,
    })
    .from(activities)
    .where(
      and(
        eq(activities.runnerId, runnerId),
        isNotNull(activities.summaryPolyline),
        lte(activities.minLat, box.maxLat),
        gte(activities.maxLat, box.minLat),
        lte(activities.minLng, box.maxLng),
        gte(activities.maxLng, box.minLng),
      ),
    );
  return rows
    .map((row) => ({
      id: row.id,
      startDate: row.startDate,
      fetched: row.detailFetchedAt !== null,
      cells: cellsCrossed(decodePolyline(row.polyline!), area),
    }))
    .filter((run) => run.cells.size > 0);
}

type Plan = {
  cellsTotal: number;
  /** Cells already crossed by runs whose details were fetched before. */
  cellsCovered: number;
  runs: { id: number; newCells: number }[];
};

/**
 * Orders the runs still needing details greedily by new ground: each time, the run crossing
 * the most cells not yet covered (newest first on ties). Runs adding no new ground are left
 * out, so fetching the whole plan reaches 100% coverage.
 */
function planRuns(candidates: CandidateRun[]): Plan {
  const all = new Set<number>();
  const covered = new Set<number>();
  for (const run of candidates) {
    for (const cell of run.cells) {
      all.add(cell);
      if (run.fetched) covered.add(cell);
    }
  }
  const cellsCovered = covered.size;
  const newCellsOf = (run: CandidateRun) => {
    let count = 0;
    for (const cell of run.cells) if (!covered.has(cell)) count += 1;
    return count;
  };
  type Entry = { run: CandidateRun; gain: number };
  const before = (a: Entry, b: Entry) =>
    b.gain - a.gain || b.run.startDate.getTime() - a.run.startDate.getTime() || b.run.id - a.run.id;
  // Lazy greedy: a run's gain only shrinks as ground is covered, so a stale gain is an upper
  // bound, and a run whose fresh gain still leads can be taken without rescoring the rest.
  const queue: Entry[] = candidates
    .filter((run) => !run.fetched)
    .map((run) => ({ run, gain: newCellsOf(run) }))
    .sort(before);
  const runs: Plan['runs'] = [];
  while (queue.length > 0) {
    const top = queue.shift()!;
    top.gain = newCellsOf(top.run);
    if (top.gain === 0) continue;
    if (queue.length > 0 && before(top, queue[0]!) > 0) {
      const at = queue.findIndex((entry) => before(top, entry) <= 0);
      queue.splice(at === -1 ? queue.length : at, 0, top);
      continue;
    }
    runs.push({ id: top.run.id, newCells: top.gain });
    for (const cell of top.run.cells) covered.add(cell);
  }
  return { cellsTotal: all.size, cellsCovered, runs };
}

const coverageOf = (covered: number, total: number) => (total === 0 ? 1 : covered / total);

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * The ~COVERAGE_CELL_M grid cells inside the area that the polyline crosses. The grid is laid
 * out in metres from the area's centre; points are sampled every half cell along each leg so
 * the long straight legs of a summary polyline don't skip cells.
 */
function cellsCrossed(points: LatLng[], area: CrawlArea): Set<number> {
  const cells = new Set<number>();
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos((area.lat * Math.PI) / 180);
  const radius = area.radiusKm * 1000;
  const local = points.map((point) => ({
    x: (point.lng - area.lng) * metresPerDegreeLng,
    y: (point.lat - area.lat) * METRES_PER_DEGREE_LAT,
  }));
  const add = (x: number, y: number) => {
    if (x * x + y * y > radius * radius) return;
    // Unique while |cell index| < 2^19, far beyond any area's radius in cells.
    cells.add(Math.floor(x / COVERAGE_CELL_M) * 2 ** 20 + Math.floor(y / COVERAGE_CELL_M));
  };
  local.forEach((point, i) => {
    const previous = local[i - 1];
    if (!previous) return add(point.x, point.y);
    const legLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    const steps = Math.max(1, Math.ceil(legLength / (COVERAGE_CELL_M / 2)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      add(previous.x + (point.x - previous.x) * t, previous.y + (point.y - previous.y) * t);
    }
  });
  return cells;
}

/** A lat/lng box a little larger than the area, for index prefilters. */
function boxAround(area: CrawlArea) {
  const dLat = ((area.radiusKm * 1000) / METRES_PER_DEGREE_LAT) * 1.01;
  const dLng = dLat / Math.cos((area.lat * Math.PI) / 180);
  return {
    minLat: area.lat - dLat,
    maxLat: area.lat + dLat,
    minLng: area.lng - dLng,
    maxLng: area.lng + dLng,
  };
}

/** Whether a point is in the area by great-circle distance, as ranking judges it. */
function inArea(point: LatLng, area: CrawlArea): boolean {
  return distanceKm(area, point) <= area.radiusKm;
}
