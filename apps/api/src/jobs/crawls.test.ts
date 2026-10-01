import { boundingBoxOf, encodePolyline, type LatLng } from '@mykom/shared';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activities,
  crawlRuns,
  crawls,
  mappedAreas,
  runners,
  runnerSegments,
  segments,
  stravaJobs,
} from '../db/schema.js';
import { createStravaClient } from '../strava/client.js';
import { randomAthleteId, useOwnTestDatabase } from '../test/app.js';
import { CRAWL_RUNS_AHEAD, onCrawlJobFinished, startCrawl } from './crawls.js';
import { createStravaJobHandlers } from './handlers.js';
import { createJobQueue, JOB_PRIORITY } from './queue.js';

const { database } = useOwnTestDatabase();

const NOW = new Date('2026-09-29T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const CENTRE = { lat: 45.42, lng: -75.69 };
const AREA = { ...CENTRE, radiusKm: 1 };

/** A point x metres east and y metres north of the centre. */
function at(x: number, y: number): LatLng {
  return {
    lat: CENTRE.lat + y / 111_320,
    lng: CENTRE.lng + x / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

/** An east-west line y metres north of the centre, from x0 to x1 metres east. */
const line = (y: number, x0: number, x1: number) => [at(x0, y), at(x1, y)];

/** Back and forth across the area in rows 100 m apart: nearly every cell in it. */
function sweep(): LatLng[] {
  const points: LatLng[] = [];
  for (let y = -950; y <= 950; y += 100) {
    const row = [at(-1000, y), at(1000, y)];
    points.push(...((y / 100) % 2 === 0 ? row : row.reverse()));
  }
  return points;
}

type SeededRun = { id: number; route: LatLng[] | null; daysAgo?: number; fetched?: boolean };

let runnerId: number;
// What the fake Strava answers: each run's Segments, and each Segment's start.
let runSegments: Map<number, number[]>;
let segmentStarts: Map<number, LatLng>;
let routes: Map<number, LatLng[] | null>;

function segmentBody(id: number) {
  const start = segmentStarts.get(id) ?? CENTRE;
  return {
    id,
    name: `Segment ${id}`,
    activity_type: 'Run',
    distance: 500,
    average_grade: 1,
    maximum_grade: 3,
    elevation_high: 60,
    elevation_low: 55,
    start_latlng: [start.lat, start.lng],
    end_latlng: [start.lat + 0.004, start.lng],
    hazardous: false,
    starred: false,
  };
}

function runBody(id: number) {
  const route = routes.get(id);
  return {
    id,
    name: `Run ${id}`,
    type: 'Run',
    sport_type: 'Run',
    start_date: NOW.toISOString(),
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1500,
    map: { summary_polyline: route ? encodePolyline(route) : '' },
    segment_efforts: (runSegments.get(id) ?? []).map((segmentId, i) => ({
      id: id * 1000 + i,
      activity: { id },
      name: `Segment ${segmentId}`,
      distance: 500,
      elapsed_time: 120,
      moving_time: 120,
      start_date: NOW.toISOString(),
      kom_rank: null,
      achievements: [],
      segment: segmentBody(segmentId),
    })),
  };
}

function setup({ concurrency = 1 } = {}) {
  const { db } = database();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const [, , , kind, id] = url.pathname.split('/');
    if (kind === 'activities' && routes.has(Number(id))) return Response.json(runBody(Number(id)));
    if (kind === 'segments' && segmentStarts.has(Number(id))) {
      return Response.json({
        ...segmentBody(Number(id)),
        total_elevation_gain: 5,
        athlete_count: 100,
        map: { polyline: '' },
        xoms: { kom: '1:30', qom: '1:50' },
      });
    }
    return Response.json({ message: 'Record Not Found' }, { status: 404 });
  });
  let now = NOW;
  const client = createStravaClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenStore: {
      load: async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: new Date('2100-01-01T00:00:00Z'),
      }),
      save: async () => {},
    },
    fetch,
    now: () => now,
  });
  const queue = createJobQueue(db, createStravaJobHandlers({ log: { warn: vi.fn() } }), {
    onFinished: onCrawlJobFinished,
  });
  const drain = () =>
    queue.drain({
      deadline: new Date(now.getTime() + HOUR),
      now: () => now,
      strava: client,
      concurrency,
    });
  const later = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  return { db, fetch, drain, later };
}

async function seedRuns(runs: SeededRun[], runner = runnerId) {
  for (const run of runs) {
    routes.set(run.id, run.route);
    await database()
      .db.insert(activities)
      .values({
        id: run.id,
        runnerId: runner,
        name: `Run ${run.id}`,
        sportType: 'Run',
        startDate: new Date(NOW.getTime() - (run.daysAgo ?? 1) * 24 * HOUR),
        distance: 5000,
        movingTime: 1500,
        summaryPolyline: run.route ? encodePolyline(run.route) : null,
        ...(run.route ? boundingBoxOf(run.route) : {}),
        detailFetchedAt: run.fetched ? NOW : null,
      });
  }
}

async function seedSegment(id: number, start: LatLng, { fetched = false } = {}) {
  segmentStarts.set(id, start);
  await database()
    .db.insert(segments)
    .values({
      id,
      name: `Segment ${id}`,
      distance: 500,
      startLat: start.lat,
      startLng: start.lng,
      detailFetchedAt: fetched ? NOW : null,
    });
}

async function plan(crawlId: number) {
  return database()
    .db.select()
    .from(crawlRuns)
    .where(eq(crawlRuns.crawlId, crawlId))
    .orderBy(asc(crawlRuns.position));
}

async function crawlRow(crawlId: number) {
  const [row] = await database().db.select().from(crawls).where(eq(crawls.id, crawlId));
  return row!;
}

async function jobs(kind: 'activity-detail' | 'segment-detail') {
  return database()
    .db.select()
    .from(stravaJobs)
    .where(eq(stravaJobs.kind, kind))
    .orderBy(asc(stravaJobs.id));
}

beforeEach(async () => {
  const { db } = database();
  await db.delete(stravaJobs);
  await db.delete(runners);
  await db.delete(segments);
  const [runner] = await db
    .insert(runners)
    .values({ stravaAthleteId: randomAthleteId(), firstName: 'Crawler' })
    .returning({ id: runners.id });
  runnerId = runner!.id;
  runSegments = new Map();
  segmentStarts = new Map();
  routes = new Map();
});

describe('selecting the runs', () => {
  it('plans only the Runner’s unfetched runs whose polyline passes through the area', async () => {
    const { db } = setup();
    const [other] = await db
      .insert(runners)
      .values({ stravaAthleteId: randomAthleteId(), firstName: 'Other' })
      .returning({ id: runners.id });
    await seedRuns([
      { id: 1, route: line(0, -500, 500) },
      // Its bounding box overlaps the area's, but it only skirts the circle's corner.
      { id: 2, route: [at(900, 1400), at(1400, 1400), at(1400, 900)] },
      { id: 3, route: line(0, 5000, 6000) },
      { id: 4, route: null },
      // Starts far away and crosses the area.
      { id: 5, route: [at(-8000, 300), at(8000, 300)] },
      // Already fetched: its ground counts as covered, but it isn't fetched again.
      { id: 6, route: line(-300, -500, 500), fetched: true },
    ]);
    await seedRuns([{ id: 7, route: line(0, -500, 500) }], other!.id);

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);

    expect((await plan(crawlId)).map((run) => run.activityId).sort()).toEqual([1, 5]);
    const crawl = await crawlRow(crawlId);
    expect(crawl).toMatchObject({ runsTotal: 2, runsChecked: 0, status: 'running' });
    // Runs 1, 5 and 6 each cross about 10 or 20 cells; 6's are covered already.
    expect(crawl.cellsCovered).toBeGreaterThanOrEqual(10);
    expect(crawl.cellsCovered).toBeLessThanOrEqual(12);
    expect(crawl.coverage).toBeCloseTo(crawl.cellsCovered / crawl.cellsTotal);
  });

  it('with no runs through the area, finishes straight away at full coverage', async () => {
    const { db } = setup();
    await seedRuns([{ id: 1, route: line(0, 5000, 6000) }]);

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);

    expect(await crawlRow(crawlId)).toMatchObject({
      runsTotal: 0,
      coverage: 1,
      stopReason: 'all-runs',
      status: 'done',
      finishedAt: NOW,
    });
    expect(await jobs('activity-detail')).toEqual([]);
  });
});

describe('ordering by new ground', () => {
  it('takes the run adding the most new ground each time, newest first on ties', async () => {
    const { db } = setup();
    await seedRuns([
      { id: 1, route: line(0, -950, 950), daysAgo: 100 },
      // Inside run 1's ground: nothing new, so it's left out.
      { id: 2, route: line(0, -900, 0), daysAgo: 1 },
      // Two identical routes: the newer one goes first and the older adds nothing.
      { id: 3, route: line(400, -500, 500), daysAgo: 50 },
      { id: 4, route: line(400, -500, 500), daysAgo: 10 },
      // Mostly on run 1's ground, then a little of its own.
      { id: 5, route: [at(-950, 0), at(0, 0), at(0, 250)], daysAgo: 5 },
      // Longer than run 5's new part but shorter than run 1.
      { id: 6, route: line(-400, -700, 700), daysAgo: 20 },
    ]);

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);

    const runs = await plan(crawlId);
    expect(runs.map((run) => run.activityId)).toEqual([1, 6, 4, 5]);
    expect(runs[3]!.newCells).toBeLessThan(runs[2]!.newCells);
    const crawl = await crawlRow(crawlId);
    expect(runs.reduce((sum, run) => sum + run.newCells, 0)).toBe(crawl.cellsTotal);
  });
});

describe('fetching the runs', () => {
  it('queues runs a few at a time and a Mapped Area goes on to 100% coverage', async () => {
    const { db, drain } = setup({ concurrency: 8 });
    const runs = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      route: line(-900 + i * 150, -300, 300),
      daysAgo: i + 1,
    }));
    await seedRuns(runs);
    for (const run of runs) {
      await seedSegment(100 + run.id, at(0, -900 + (run.id - 1) * 150));
      runSegments.set(run.id, [100 + run.id]);
    }
    const [mapped] = await db
      .insert(mappedAreas)
      .values({ runnerId, label: 'Ottawa', ...CENTRE, radiusKm: 1 })
      .returning();

    const crawlId = await startCrawl(db, { runnerId, area: AREA, mappedAreaId: mapped!.id }, NOW);

    const queued = await jobs('activity-detail');
    expect(queued).toHaveLength(CRAWL_RUNS_AHEAD);
    expect(queued.every((job) => job.priority === JOB_PRIORITY.mapping)).toBe(true);
    expect(queued.map((job) => job.target)).toEqual(
      (await plan(crawlId)).slice(0, CRAWL_RUNS_AHEAD).map((run) => run.activityId),
    );
    expect(await crawlRow(crawlId)).toMatchObject({
      runsTotal: 12,
      runsChecked: 0,
      segmentsTotal: 0,
    });

    await drain();

    expect(await jobs('activity-detail')).toHaveLength(12);
    const segmentJobs = await jobs('segment-detail');
    expect(segmentJobs).toHaveLength(12);
    expect(segmentJobs.every((job) => job.priority === JOB_PRIORITY.mapping)).toBe(true);
    expect(await crawlRow(crawlId)).toMatchObject({
      runsTotal: 12,
      runsChecked: 12,
      segmentsFound: 12,
      segmentsTotal: 12,
      segmentsChecked: 12,
      coverage: 1,
      stopReason: 'all-runs',
      status: 'done',
      finishedAt: NOW,
    });
  });

  it('a search stops fetching runs at 95% coverage', async () => {
    const { db, drain } = setup();
    // One run sweeping the whole area, then eight short ones, each in an edge cell the sweep
    // misses.
    const edgeCells = [
      [415, 901],
      [-415, 901],
      [415, -901],
      [-415, -901],
      [901, 415],
      [901, -415],
      [-901, 415],
      [-901, -415],
    ];
    await seedRuns([
      { id: 1, route: sweep(), daysAgo: 30 },
      ...edgeCells.map(([x, y], i) => ({
        id: i + 2,
        route: [at(x!, y!), at(x! + Math.sign(x!) * 5, y! + Math.sign(y!) * 5)],
        daysAgo: i + 1,
      })),
    ]);

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);
    const runs = await plan(crawlId);
    expect(runs.map((run) => run.newCells).slice(1)).toEqual(edgeCells.map(() => 1));
    const crawl = await crawlRow(crawlId);
    expect(runs[0]!.newCells / crawl.cellsTotal).toBeGreaterThanOrEqual(0.95);

    await drain();

    const stopped = await crawlRow(crawlId);
    expect(stopped.stopReason).toBe('coverage');
    // Only the runs already queued when the sweep landed were fetched.
    expect(await jobs('activity-detail')).toHaveLength(CRAWL_RUNS_AHEAD);
    expect((await plan(crawlId)).filter((run) => run.queuedAt === null)).toHaveLength(
      runs.length - CRAWL_RUNS_AHEAD,
    );
    expect(stopped).toMatchObject({ runsChecked: CRAWL_RUNS_AHEAD, status: 'done' });
  });

  it('a search stops when the last 10 runs added fewer than 3 new Segments', async () => {
    const { db, drain } = setup();
    // 25 runs on ground of their own (4 cells each), newest first in the plan.
    const runs = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      route: line(-550 + (i % 13) * 100, i < 13 ? -550 : 250, i < 13 ? -250 : 550),
      daysAgo: i + 1,
    }));
    await seedRuns(runs);
    // Run 1 finds 3 new Segments in the area (and one outside it); every later run only
    // repeats one of them.
    await seedSegment(201, at(0, 0));
    await seedSegment(202, at(100, 0));
    await seedSegment(203, at(200, 0));
    await seedSegment(299, at(5000, 0));
    runSegments.set(1, [201, 202, 203, 299]);
    for (const run of runs.slice(1)) runSegments.set(run.id, [201]);

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);
    await drain();

    const crawl = await crawlRow(crawlId);
    expect(crawl.stopReason).toBe('few-new-segments');
    // After 10 runs the last 10 still hold run 1's 3; after the 11th they hold none. The 7
    // runs queued by then still land.
    expect(crawl.recentNewSegments.slice(0, 11)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(crawl.runsChecked).toBe(11 + CRAWL_RUNS_AHEAD - 1);
    expect(await jobs('activity-detail')).toHaveLength(11 + CRAWL_RUNS_AHEAD - 1);
    expect(crawl).toMatchObject({ runsTotal: 25, segmentsFound: 3, status: 'done' });
    const first = (await plan(crawlId))[0]!;
    expect(first).toMatchObject({ activityId: 1, newSegments: 3 });
  });

  it('a run that fails for good doesn’t hold the crawl up', async () => {
    const { db, drain, later } = setup();
    await seedRuns([
      { id: 1, route: line(0, -500, 500) },
      { id: 2, route: line(300, -500, 500), daysAgo: 2 },
    ]);
    // Strava doesn't know run 2.
    routes.delete(2);

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await drain();
      later(HOUR);
    }

    const [failed] = await db
      .select()
      .from(stravaJobs)
      .where(and(eq(stravaJobs.target, 2), eq(stravaJobs.kind, 'activity-detail')));
    expect(failed!.status).toBe('failed');
    expect(await crawlRow(crawlId)).toMatchObject({
      runsTotal: 2,
      runsChecked: 1,
      stopReason: 'all-runs',
      status: 'done',
    });
  });

  it('counts a run as checked for every crawl that planned it', async () => {
    const { db, drain } = setup();
    await seedRuns([{ id: 1, route: line(0, -500, 500) }]);
    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);
    const other = await startCrawl(db, { runnerId, area: { ...AREA, radiusKm: 2 } }, NOW);

    await drain();

    // One job served both crawls.
    expect(await jobs('activity-detail')).toHaveLength(1);
    for (const id of [crawlId, other]) {
      expect(await crawlRow(id)).toMatchObject({ runsChecked: 1, status: 'done' });
    }
  });
});

describe('queueing Segment details', () => {
  it('queues the missing ones in the area: hints, then most run, then nearest the centre', async () => {
    const { db } = setup();
    const known = [
      { id: 1, start: at(900, 0), effortCount: 1, topTenHint: false },
      { id: 2, start: at(800, 0), effortCount: 1, topTenHint: true },
      { id: 3, start: at(700, 0), effortCount: 6, topTenHint: false },
      { id: 4, start: at(0, 100), effortCount: 1, topTenHint: false },
      // Starred, never run.
      { id: 5, start: at(0, 50), effortCount: 0, topTenHint: false, viaStarred: true },
      { id: 6, start: at(0, 600), effortCount: 1, topTenHint: false },
      // Already has details, outside the area, and already pending: not queued.
      { id: 7, start: at(0, 0), effortCount: 9, topTenHint: true, fetched: true },
      { id: 8, start: at(0, 1100), effortCount: 9, topTenHint: true },
      { id: 9, start: at(0, 10), effortCount: 9, topTenHint: true },
    ];
    for (const segment of known) {
      await seedSegment(segment.id, segment.start, { fetched: segment.fetched });
      await db.insert(runnerSegments).values({
        runnerId,
        segmentId: segment.id,
        viaRun: segment.effortCount > 0,
        viaStarred: segment.viaStarred ?? false,
        effortCount: segment.effortCount,
        topTenHint: segment.topTenHint,
      });
    }
    // Another Runner's Known Segment.
    await seedSegment(10, at(0, 0));
    await db.insert(stravaJobs).values({
      kind: 'segment-detail',
      target: 9,
      runnerId,
      priority: JOB_PRIORITY.search,
    });

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);

    const queued = (await jobs('segment-detail')).map((job) => job.target);
    expect(queued).toEqual([9, 2, 3, 4, 6, 1, 5]);
    expect(await crawlRow(crawlId)).toMatchObject({
      segmentsTotal: 8,
      segmentsChecked: 1,
      status: 'running',
    });
  });

  it('fills in progress as the details land, and finishes when they have', async () => {
    const { db, drain } = setup();
    for (const id of [1, 2, 3]) {
      await seedSegment(id, at(id * 100, 0));
      await db.insert(runnerSegments).values({ runnerId, segmentId: id, viaStarred: true });
    }

    const crawlId = await startCrawl(db, { runnerId, area: AREA }, NOW);
    expect(await crawlRow(crawlId)).toMatchObject({
      segmentsTotal: 3,
      segmentsChecked: 0,
      status: 'running',
    });

    await drain();

    expect(await crawlRow(crawlId)).toMatchObject({
      segmentsTotal: 3,
      segmentsChecked: 3,
      status: 'done',
      finishedAt: NOW,
    });
  });
});
