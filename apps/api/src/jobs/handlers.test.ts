import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activities,
  mappedAreas,
  runnerSegments,
  runners,
  searchAreas,
  segmentEfforts,
  segments,
  stravaJobs,
} from '../db/schema.js';
import { createStravaClient, STRAVA_PAGE_SIZE } from '../strava/client.js';
import { randomAthleteId, useOwnTestDatabase } from '../test/app.js';
import { createStravaJobHandlers } from './handlers.js';
import { createJobQueue, JOB_PRIORITY } from './queue.js';

const { database } = useOwnTestDatabase();

const NOW = new Date('2026-09-29T12:05:00Z');
const MINUTE = 60 * 1000;

const fixture = (name: string) =>
  readFileSync(new URL(`../strava/fixtures/${name}.json`, import.meta.url), 'utf8');

// The activity fixture: run 20377567085 with efforts on three Segments; the effort on
// 40464681 has an `overall` achievement and kom_rank 5.
const RUN_ID = 20377567085;
const SEGMENT_ID = 8793341;

type Body = Record<string, unknown>;
const segmentFixture = () => JSON.parse(fixture('segment')) as Body;
const starredFixture = () => JSON.parse(fixture('starred')) as Body[];

function summarySegment(id: number, overrides: Body = {}): Body {
  return {
    id,
    name: `Segment ${id}`,
    activity_type: 'Run',
    distance: 800,
    average_grade: 1,
    maximum_grade: 3,
    elevation_high: 60,
    elevation_low: 50,
    start_latlng: [45.42, -75.69],
    end_latlng: [45.43, -75.7],
    hazardous: false,
    starred: false,
    ...overrides,
  };
}

function effort(
  id: number,
  segmentId: number,
  elapsedTime: number,
  { startDate = '2026-09-29T11:20:00Z', komRank = null as number | null, achievement = '' } = {},
): Body {
  return {
    id,
    activity: { id: 0 },
    name: `Segment ${segmentId}`,
    elapsed_time: elapsedTime,
    moving_time: elapsedTime,
    start_date: startDate,
    distance: 800,
    kom_rank: komRank,
    pr_rank: null,
    achievements: achievement ? [{ type_id: 2, type: achievement, rank: komRank ?? 1 }] : [],
    segment: summarySegment(segmentId),
  };
}

function run(id: number, efforts: Body[], startDate = '2026-09-29T11:11:55Z'): Body {
  return {
    id,
    name: `Run ${id}`,
    type: 'Run',
    sport_type: 'Run',
    start_date: startDate,
    distance: 10000,
    moving_time: 2400,
    elapsed_time: 2500,
    map: { summary_polyline: '' },
    segment_efforts: efforts.map((e) => ({ ...e, activity: { id } })),
  };
}

/** A fake Strava answering by path; each path's body can be replaced per test. */
function fakeStrava() {
  const bodies = new Map<string, string>([
    [`/activities/${RUN_ID}`, fixture('activity')],
    [`/segments/${SEGMENT_ID}`, fixture('segment')],
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const key =
      url.pathname.replace('/api/v3', '') +
      (url.pathname.endsWith('starred') ? `?page=${url.searchParams.get('page')}` : '');
    const body = bodies.get(key);
    if (body === undefined) return Response.json({ message: 'Record Not Found' }, { status: 404 });
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  });
  const set = (path: string, body: unknown) =>
    bodies.set(path, typeof body === 'string' ? body : JSON.stringify(body));
  return { fetch, set };
}

function setup() {
  const { db } = database();
  const strava = fakeStrava();
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
    fetch: strava.fetch,
    now: () => NOW,
  });
  const log = { warn: vi.fn() };
  const queue = createJobQueue(db, createStravaJobHandlers({ log }));
  const drain = () =>
    queue.drain({ deadline: new Date(NOW.getTime() + MINUTE), now: () => NOW, strava: client });
  return { db, strava, log, queue, drain };
}

let runnerId: number;

beforeEach(async () => {
  const { db } = database();
  // Each test starts from an empty queue; Segments are shared, so they're cleared too.
  await db.delete(stravaJobs);
  await db.delete(runners);
  await db.delete(segments);
  const [runner] = await db
    .insert(runners)
    .values({ stravaAthleteId: randomAthleteId(), firstName: 'Handler' })
    .returning({ id: runners.id });
  runnerId = runner!.id;
});

async function linkOf(segmentId: number, runner = runnerId) {
  const [row] = await database()
    .db.select()
    .from(runnerSegments)
    .where(and(eq(runnerSegments.runnerId, runner), eq(runnerSegments.segmentId, segmentId)));
  return row;
}

async function segmentRow(segmentId: number) {
  const [row] = await database().db.select().from(segments).where(eq(segments.id, segmentId));
  return row;
}

async function pendingJobs() {
  return database()
    .db.select({
      kind: stravaJobs.kind,
      target: stravaJobs.target,
      priority: stravaJobs.priority,
      runnerId: stravaJobs.runnerId,
    })
    .from(stravaJobs)
    .where(eq(stravaJobs.status, 'pending'));
}

describe('activity detail', () => {
  it('stores the run, its efforts and summary-only Segments, and links them to the Runner', async () => {
    const { db, queue, drain } = setup();
    await queue.enqueue(
      { kind: 'activity-detail', target: RUN_ID, runnerId, priority: 'new-run' },
      NOW,
    );

    expect(await drain()).toMatchObject({ succeeded: 1, failed: 0 });

    const [activity] = await db.select().from(activities).where(eq(activities.id, RUN_ID));
    expect(activity).toMatchObject({
      runnerId,
      name: 'Morning Run',
      movingTime: 4687,
      detailFetchedAt: NOW,
    });
    expect(activity!.summaryPolyline).not.toBeNull();
    expect(activity!.minLat).not.toBeNull();

    const efforts = await db
      .select()
      .from(segmentEfforts)
      .where(eq(segmentEfforts.activityId, RUN_ID));
    // Strava's 19-digit effort ids are kept exactly.
    expect(efforts.map((e) => e.id).sort()).toEqual([
      3539994790397326017n,
      3539994790397327017n,
      3539994790397328017n,
    ]);

    const shuster = await segmentRow(SEGMENT_ID);
    expect(shuster).toMatchObject({
      name: 'Joe Shuster Wayyy',
      distance: 499.9,
      averageGrade: 1.2,
      startLat: 43.639712,
      detailFetchedAt: null,
      komStatus: null,
    });

    expect(await linkOf(SEGMENT_ID)).toMatchObject({
      viaRun: true,
      viaStarred: false,
      effortCount: 1,
      bestSeconds: 131,
      bestDate: new Date('2026-09-29T11:18:01Z'),
      topTenHint: false,
    });
    expect(await linkOf(40464681)).toMatchObject({ bestSeconds: 453, topTenHint: true });

    // Only the effort with the achievement and top-10 rank queues its Segment's details.
    expect(await pendingJobs()).toEqual([
      { kind: 'segment-detail', target: 40464681, priority: JOB_PRIORITY.search, runnerId },
    ]);
  });

  it("queues a new run's Segments inside a saved area at mapping priority", async () => {
    const { db, strava, queue, drain } = setup();
    // A 5 km Search Area in Ottawa and a 10 km Mapped Area in Toronto.
    await db
      .insert(searchAreas)
      .values({ runnerId, label: 'Ottawa', lat: 45.42, lng: -75.69, radiusKm: 5 });
    await db
      .insert(mappedAreas)
      .values({ runnerId, label: 'Toronto', lat: 43.65, lng: -79.38, radiusKm: 10 });
    const [inSearch, inMapped, outside, detailed, hinted] = [7001, 7002, 7003, 7004, 7005];
    const at = (id: number, lat: number, lng: number): Body => ({
      ...effort(id * 10, id, 200),
      segment: summarySegment(id, { start_latlng: [lat, lng] }),
    });
    await db.insert(segments).values({
      id: detailed,
      name: 'Already fetched',
      activityType: 'Run',
      distance: 800,
      startLat: 45.421,
      startLng: -75.691,
      detailFetchedAt: NOW,
    });
    const efforts = [
      at(inSearch, 45.425, -75.69),
      at(inMapped, 43.7, -79.4),
      at(outside, 45.5, -75.69),
      at(detailed, 45.421, -75.691),
      { ...at(hinted, 45.42, -75.69), kom_rank: 3 },
    ];
    const hintedJob = {
      kind: 'segment-detail',
      target: hinted,
      priority: JOB_PRIORITY.search,
      runnerId,
    };

    // A crawl's run (search priority) leaves its area's details to the crawl.
    strava.set('/activities/1', run(1, efforts));
    await queue.enqueue({ kind: 'activity-detail', target: 1, runnerId, priority: 'search' }, NOW);
    expect(await drain()).toMatchObject({ succeeded: 1, failed: 0 });
    expect(await pendingJobs()).toEqual([hintedJob]);

    await db.delete(stravaJobs);
    strava.set(
      '/activities/2',
      run(
        2,
        efforts.map((e) => ({ ...e, id: Number(e.id) + 1 })),
      ),
    );
    await queue.enqueue({ kind: 'activity-detail', target: 2, runnerId, priority: 'new-run' }, NOW);
    expect(await drain()).toMatchObject({ succeeded: 1, failed: 0 });
    const pending = await pendingJobs();
    expect(pending).toHaveLength(3);
    expect(pending).toEqual(
      expect.arrayContaining([
        { kind: 'segment-detail', target: inSearch, priority: JOB_PRIORITY.mapping, runnerId },
        { kind: 'segment-detail', target: inMapped, priority: JOB_PRIORITY.mapping, runnerId },
        hintedJob,
      ]),
    );
  });

  it('keeps the best effort across runs, and a re-fetched run replaces its efforts', async () => {
    const { db, strava, queue, drain } = setup();
    strava.set(
      '/activities/1',
      run(1, [effort(11, 500, 200), effort(12, 500, 190)], '2026-09-01T10:00:00Z'),
    );
    strava.set(
      '/activities/2',
      run(2, [effort(21, 500, 185, { startDate: '2026-09-10T10:05:00Z' }), effort(22, 600, 300)]),
    );
    for (const id of [1, 2]) {
      await queue.enqueue(
        { kind: 'activity-detail', target: id, runnerId, priority: 'search' },
        NOW,
      );
    }
    await drain();
    expect(await linkOf(500)).toMatchObject({
      effortCount: 3,
      bestSeconds: 185,
      bestDate: new Date('2026-09-10T10:05:00Z'),
    });

    // Run 2 was edited on Strava: it no longer passes Segment 600, and its 500 effort is slower.
    strava.set('/activities/2', run(2, [effort(23, 500, 195)]));
    await queue.enqueue({ kind: 'activity-detail', target: 2, runnerId, priority: 'search' }, NOW);
    await drain();

    expect(await linkOf(500)).toMatchObject({ effortCount: 3, bestSeconds: 190 });
    expect(await linkOf(600)).toBeUndefined();
    const efforts = await db.select().from(segmentEfforts).where(eq(segmentEfforts.activityId, 2));
    expect(efforts.map((e) => e.id)).toEqual([23n]);
  });

  it('never overwrites Segment details with a summary', async () => {
    const { queue, drain } = setup();
    await queue.enqueue(
      { kind: 'segment-detail', target: SEGMENT_ID, runnerId, priority: 'search' },
      NOW,
    );
    await queue.enqueue(
      { kind: 'activity-detail', target: RUN_ID, runnerId, priority: 'new-run' },
      NOW,
    );
    await drain();

    expect(await segmentRow(SEGMENT_ID)).toMatchObject({
      detailFetchedAt: NOW,
      athleteCount: 1842,
      komSeconds: 58,
    });
  });

  it('"I just took it": a KOM on a Segment with details re-fetches them at search priority', async () => {
    const { strava, queue, drain } = setup();
    // The Segment's details are already stored, with a 2:10 KOM.
    const before = segmentFixture();
    before.xoms = { kom: '2:10', qom: '2:40', overall: '2:10' };
    before.athlete_segment_stats = null;
    strava.set(`/segments/${SEGMENT_ID}`, before);
    await queue.enqueue(
      { kind: 'segment-detail', target: SEGMENT_ID, runnerId, priority: 'mapping' },
      NOW,
    );
    await drain();
    expect(await segmentRow(SEGMENT_ID)).toMatchObject({ komSeconds: 130 });

    // A new run takes the KOM in 2:05, and a freshness re-fetch was already waiting.
    const took = effort(31, SEGMENT_ID, 125, { komRank: 1, achievement: 'overall' });
    took.segment = summarySegment(SEGMENT_ID, { name: 'Joe Shuster Wayyy' });
    strava.set('/activities/3', run(3, [took]));
    await queue.enqueue(
      { kind: 'segment-detail', target: SEGMENT_ID, runnerId, priority: 'freshness' },
      NOW,
    );
    await queue.enqueue({ kind: 'activity-detail', target: 3, runnerId, priority: 'new-run' }, NOW);
    const after = segmentFixture();
    after.xoms = { kom: '2:05', qom: '2:40', overall: '2:05' };
    strava.set(`/segments/${SEGMENT_ID}`, after);

    // One drain runs the run, then the re-fetch it raised to search priority.
    expect(await drain()).toMatchObject({ succeeded: 2 });
    expect(await segmentRow(SEGMENT_ID)).toMatchObject({ komSeconds: 125 });
    expect(await linkOf(SEGMENT_ID)).toMatchObject({ bestSeconds: 125, topTenHint: true });
    expect(await pendingJobs()).toEqual([]);
  });
});

describe('Segment detail', () => {
  it('fills the shared Segment row and takes the PB from athlete_segment_stats', async () => {
    const { db, queue, drain } = setup();
    await db
      .insert(segments)
      .values({ id: SEGMENT_ID, name: 'Old name', distance: 499, startLat: 43.6, startLng: -79.4 });
    await db
      .insert(runnerSegments)
      .values({ runnerId, segmentId: SEGMENT_ID, viaRun: true, effortCount: 1, bestSeconds: 131 });
    await queue.enqueue(
      { kind: 'segment-detail', target: SEGMENT_ID, runnerId, priority: 'search' },
      NOW,
    );

    await drain();

    const row = await segmentRow(SEGMENT_ID);
    expect(row).toMatchObject({
      name: 'Joe Shuster Wayyy',
      distance: 499.9,
      averageGrade: 1.2,
      maximumGrade: 3.3,
      totalElevationGain: 6,
      startLat: 43.639712,
      endLng: -79.428409,
      hazardous: false,
      komSeconds: 58,
      qomSeconds: 87,
      komRaw: '58s',
      qomRaw: '1:27',
      komStatus: 'ok',
      qomStatus: 'ok',
      athleteCount: 1842,
      detailFetchedAt: NOW,
    });
    expect(row!.polyline).toMatch(/^ekjiG/);
    // pr_elapsed_time 127 is faster than the fetched effort (131).
    expect(await linkOf(SEGMENT_ID)).toMatchObject({ bestSeconds: 131, statsPrSeconds: 127 });
  });

  it('links nobody: a Runner without the Segment gets no PB row', async () => {
    const { queue, drain } = setup();
    await queue.enqueue(
      { kind: 'segment-detail', target: SEGMENT_ID, runnerId, priority: 'freshness' },
      NOW,
    );
    await drain();
    expect(await segmentRow(SEGMENT_ID)).toMatchObject({ komSeconds: 58 });
    expect(await linkOf(SEGMENT_ID)).toBeUndefined();
  });

  it('records unparseable, missing and hazardous records, logging the unparseable raw string', async () => {
    const { strava, log, queue, drain } = setup();
    const odd = segmentFixture();
    odd.xoms = { kom: 'about a minute', overall: 'about a minute' };
    odd.athlete_segment_stats = null;
    strava.set(`/segments/${SEGMENT_ID}`, odd);
    const hazardous = { ...segmentFixture(), id: 77, hazardous: true };
    strava.set('/segments/77', hazardous);
    for (const target of [SEGMENT_ID, 77]) {
      await queue.enqueue({ kind: 'segment-detail', target, runnerId, priority: 'search' }, NOW);
    }

    await drain();

    expect(await segmentRow(SEGMENT_ID)).toMatchObject({
      komStatus: 'unparseable',
      komSeconds: null,
      komRaw: 'about a minute',
      qomStatus: 'missing',
      qomRaw: null,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { segmentId: SEGMENT_ID, gender: 'KOM', raw: 'about a minute' },
      'Unparseable Target Record',
    );
    expect(await segmentRow(77)).toMatchObject({
      hazardous: true,
      komStatus: 'hazardous',
      qomStatus: 'hazardous',
      komSeconds: null,
    });
  });
});

describe('starred Segments', () => {
  it('links running Segments as starred, including one the Runner has never run', async () => {
    const { strava, queue, drain } = setup();
    const ride = { ...starredFixture()[0], id: 999, activity_type: 'Ride' };
    strava.set('/segments/starred?page=1', [...starredFixture(), ride]);
    await queue.enqueue({ kind: 'starred-segments', runnerId, priority: 'search' }, NOW);

    await drain();

    // Never run: no efforts and no PB, so it can't be Held, but it's a Known Segment.
    expect(await linkOf(2309643)).toMatchObject({
      viaStarred: true,
      viaRun: false,
      effortCount: 0,
      bestSeconds: null,
      statsPrSeconds: null,
    });
    expect(await linkOf(2667989)).toMatchObject({ viaStarred: true });
    expect(await segmentRow(2309643)).toMatchObject({
      name: 'Ave Revolution Climb',
      averageGrade: 5.1,
      detailFetchedAt: null,
    });
    // Ride Segments aren't Known Segments.
    expect(await linkOf(999)).toBeUndefined();
    expect(await segmentRow(999)).toBeUndefined();
    expect(await pendingJobs()).toEqual([]);
  });

  it('keeps the run link of a starred Segment the Runner has run, and a starred one survives losing its runs', async () => {
    const { strava, queue, drain } = setup();
    strava.set('/activities/1', run(1, [effort(11, 2309643, 240)]));
    await queue.enqueue({ kind: 'activity-detail', target: 1, runnerId, priority: 'search' }, NOW);
    strava.set('/segments/starred?page=1', starredFixture());
    await queue.enqueue({ kind: 'starred-segments', runnerId, priority: 'search' }, NOW);
    await drain();
    expect(await linkOf(2309643)).toMatchObject({
      viaRun: true,
      viaStarred: true,
      bestSeconds: 240,
    });

    strava.set('/activities/1', run(1, []));
    await queue.enqueue({ kind: 'activity-detail', target: 1, runnerId, priority: 'search' }, NOW);
    await drain();
    expect(await linkOf(2309643)).toMatchObject({
      viaRun: false,
      viaStarred: true,
      bestSeconds: null,
      effortCount: 0,
    });
  });

  it('queues the next page when a page is full', async () => {
    const { strava, queue, drain } = setup();
    const full = Array.from({ length: STRAVA_PAGE_SIZE }, (_, i) =>
      summarySegment(1000 + i, { starred: true }),
    );
    strava.set('/segments/starred?page=1', full);
    strava.set('/segments/starred?page=2', starredFixture());
    await queue.enqueue({ kind: 'starred-segments', runnerId, priority: 'mapping' }, NOW);

    expect(await drain()).toMatchObject({ succeeded: 2 });
    expect(await linkOf(1000)).toMatchObject({ viaStarred: true });
    expect(await linkOf(2309643)).toMatchObject({ viaStarred: true });
    const jobs = await database()
      .db.select({ target: stravaJobs.target, priority: stravaJobs.priority })
      .from(stravaJobs)
      .where(eq(stravaJobs.kind, 'starred-segments'));
    expect(jobs).toContainEqual({ target: 2, priority: JOB_PRIORITY.mapping });
  });
});
