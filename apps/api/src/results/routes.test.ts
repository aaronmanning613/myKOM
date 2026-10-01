// GET /api/results and GET /api/debug/segments through the API, with a fake Strava at fetch:
// the three lists from what's stored, polls draining the search's work, the budget, and the
// debug view agreeing with the results.
import {
  boundingBoxOf,
  encodePolyline,
  RUNNER_DAILY_READS,
  type DebugSegments,
  type LatLng,
  type Results,
  type SearchArea,
} from '@mykom/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import {
  activities,
  benchmarks,
  runnerSegments,
  runners,
  segments,
  stravaReadUsage,
} from '../db/schema.js';
import { windowStart } from '../jobs/budget.js';
import { saveSearchArea } from '../search-area/store.js';
import { buildTestApp, useOwnTestDatabase } from '../test/app.js';

const { database } = useOwnTestDatabase();

const CENTRE = { lat: 45.42, lng: -75.69 };
const AREA: SearchArea = { label: 'Ottawa', ...CENTRE, radiusKm: 2 };

/** A point x metres east and y metres north of the centre. */
function at(x: number, y: number): LatLng {
  return {
    lat: CENTRE.lat + y / 111_320,
    lng: CENTRE.lng + x / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

let app: ReturnType<typeof buildTestApp>['app'];
let fetch: ReturnType<typeof buildTestApp>['fetch'];
// The fake Strava's runs, each crossing one Segment of its own that starts at `start`.
let runs: Map<number, { route: LatLng[]; segmentId: number; start: LatLng }>;

function segmentSummary(id: number, start: LatLng) {
  return {
    id,
    name: `Segment ${id}`,
    activity_type: 'Run',
    distance: 1000,
    average_grade: 0,
    maximum_grade: 1,
    elevation_high: 60,
    elevation_low: 60,
    start_latlng: [start.lat, start.lng],
    end_latlng: [start.lat + 0.009, start.lng],
    hazardous: false,
    starred: false,
  };
}

const stravaReads = () => fetch.mock.calls.filter(([input]) => String(input).includes('/api/v3'));

beforeAll(() => {
  ({ app, fetch } = buildTestApp(database(), { testRoutes: true, debugRoutes: true }));
});

afterAll(() => app.close());

beforeEach(async () => {
  const { db } = database();
  await db.delete(stravaReadUsage);
  await db.delete(runners);
  await db.delete(segments);
  fetch.mockReset();
  runs = new Map();
  fetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const [, , , kind, rawId] = url.pathname.split('/');
    const id = Number(rawId);
    if (url.pathname === '/api/v3/segments/starred') return Response.json([]);
    const run = runs.get(id);
    if (kind === 'activities' && run) {
      return Response.json({
        id,
        name: `Run ${id}`,
        type: 'Run',
        sport_type: 'Run',
        start_date: '2026-09-01T12:00:00Z',
        distance: 5000,
        moving_time: 1500,
        elapsed_time: 1500,
        map: { summary_polyline: encodePolyline(run.route) },
        segment_efforts: [
          {
            id: id * 1000,
            activity: { id },
            name: `Segment ${run.segmentId}`,
            distance: 1000,
            elapsed_time: 240,
            moving_time: 240,
            start_date: '2026-09-01T12:10:00Z',
            kom_rank: null,
            achievements: [],
            segment: segmentSummary(run.segmentId, run.start),
          },
        ],
      });
    }
    const segmentRun = [...runs.values()].find((r) => r.segmentId === id);
    if (kind === 'segments' && segmentRun) {
      return Response.json({
        ...segmentSummary(id, segmentRun.start),
        total_elevation_gain: 0,
        athlete_count: 100,
        map: { polyline: '' },
        xoms: { kom: '3:05', qom: '3:05' },
      });
    }
    return Response.json({ message: 'Record Not Found' }, { status: 404 });
  });
});

/** Signs in a new Runner with a pinned 1K 3:00 and 5K 17:00 (so 1 km Segments predict 3:00). */
async function signIn() {
  const res = await app.inject({ method: 'POST', url: '/api/test/login' });
  const { id } = res.json<{ id: number }>();
  await database()
    .db.insert(benchmarks)
    .values([
      { runnerId: id, distance: '1k', seconds: 180, source: 'runner' },
      { runnerId: id, distance: '5k', seconds: 1020, source: 'runner' },
    ]);
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { id, cookies: { [SESSION_COOKIE]: session } };
}
type Session = Awaited<ReturnType<typeof signIn>>;

const getResults = (session: Session | undefined) =>
  app.inject({ url: '/api/results', cookies: session?.cookies });
const getDebug = (session: Session | undefined) =>
  app.inject({ url: '/api/debug/segments', cookies: session?.cookies });

/**
 * A Known Segment of the Runner's, 1 km and flat, stored with its details unless `pending`.
 * `kom: null` stores no record for either gender.
 */
async function seedSegment(
  runnerId: number,
  id: number,
  {
    start = at(0, 100),
    kom = '3:05',
    athleteCount = 100,
    pb = 250,
    hazardous = false,
    pending = false,
    fetchedAt = new Date(),
  }: {
    start?: LatLng;
    kom?: string | null;
    athleteCount?: number;
    pb?: number | null;
    hazardous?: boolean;
    pending?: boolean;
    fetchedAt?: Date;
  } = {},
) {
  await database()
    .db.insert(segments)
    .values({
      id,
      name: `Segment ${id}`,
      activityType: 'Run',
      distance: 1000,
      averageGrade: 0,
      maximumGrade: 1,
      totalElevationGain: 0,
      startLat: start.lat,
      startLng: start.lng,
      hazardous,
      komRaw: kom,
      qomRaw: kom,
      athleteCount,
      detailFetchedAt: pending ? null : fetchedAt,
    })
    .onConflictDoNothing();
  await database()
    .db.insert(runnerSegments)
    .values(
      pb === null
        ? { runnerId, segmentId: id, viaStarred: true }
        : { runnerId, segmentId: id, viaRun: true, effortCount: 1, bestSeconds: pb },
    );
}

const OLD_CHECK = new Date('2026-06-01T00:00:00Z');

/**
 * One Segment of each kind in (and around) the area. With a 3:00 prediction: 1 is Achievable,
 * 2 a miss, 3 Implausible, 4 Held (outside the margin), 5 hazardous, 6 without a record,
 * 7 pending, 8 far away and 9 in the bounding box but outside the circle.
 */
async function seedArea(runnerId: number) {
  await saveSearchArea(database().db, runnerId, AREA);
  await seedSegment(runnerId, 1, { kom: '3:05', athleteCount: 500, fetchedAt: OLD_CHECK });
  await seedSegment(runnerId, 2, { start: at(300, 0), kom: '2:30', athleteCount: 400 });
  await seedSegment(runnerId, 3, { start: at(0, -300), kom: '1:30', athleteCount: 300 });
  await seedSegment(runnerId, 4, { start: at(-300, 0), kom: '2:30', pb: 140 });
  await seedSegment(runnerId, 5, { hazardous: true });
  await seedSegment(runnerId, 6, { kom: null });
  await seedSegment(runnerId, 7, { pending: true });
  await seedSegment(runnerId, 8, { start: at(0, 5000) });
  await seedSegment(runnerId, 9, { start: at(1900, 1900) });
}

async function setUsage(runnerId: number | null, window: '15min' | 'day', reads: number) {
  await database()
    .db.insert(stravaReadUsage)
    .values({ runnerId, window, windowStart: windowStart(window, new Date()), reads });
}

let nextRunId = 5_000;

/** Stored runs across the area, each in its own 100 m row with a Segment of its own. */
async function seedRuns(runnerId: number, count: number) {
  for (let i = 0; i < count; i++) {
    const id = ++nextRunId;
    const y = -1450 + i * 100;
    const route = [at(-500, y), at(500, y)];
    runs.set(id, { route, segmentId: id * 10, start: at(0, y) });
    await database()
      .db.insert(activities)
      .values({
        id,
        runnerId,
        name: `Run ${id}`,
        sportType: 'Run',
        startDate: new Date(Date.UTC(2026, 8, 1) - i * 86_400_000),
        distance: 5000,
        movingTime: 1500,
        summaryPolyline: encodePolyline(route),
        ...boundingBoxOf(route),
      });
  }
}

const ids = (rows: { segmentId: number }[]) => rows.map((row) => row.segmentId);

describe('GET /api/results', () => {
  it('is 401 when signed out, and 404 without a Search Area', async () => {
    expect((await getResults(undefined)).statusCode).toBe(401);
    const res = await getResults(await signIn());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'no_search_area' });
  });

  it('ranks the stored Known Segments in the area into the three lists, with no Strava calls', async () => {
    const session = await signIn();
    await seedArea(session.id);

    const res = await getResults(session);

    expect(res.statusCode).toBe(200);
    const results = res.json<Results>();
    // Held 4 comes after 1: its Predicted Time is outside the margin, and it's high confidence
    // like 1 but less impressive.
    expect(ids(results.targets)).toEqual([1, 4]);
    expect(ids(results.nearestMisses)).toEqual([2]);
    expect(ids(results.suspicious)).toEqual([3]);
    expect(results).toMatchObject({
      searchArea: AREA,
      recordGender: 'KOM',
      achievableCount: 1,
      // 1-6 have details and start in the area.
      knownCount: 6,
      enoughBenchmarks: true,
      progress: null,
      pending: false,
      budget: { continuesTomorrow: false, pausedUntil: null },
    });
    expect(results.targets[0]).toEqual({
      segmentId: 1,
      name: 'Segment 1',
      distance: 1000,
      averageGrade: 0,
      kmFromCentre: expect.closeTo(0.1, 2) as number,
      athleteCount: 500,
      record: 185,
      predicted: { seconds: 180, confidence: 'high', reason: 'within-range' },
      pb: 250,
      held: false,
      implausible: false,
      recordCheckedAt: OLD_CHECK.toISOString(),
    });
    expect(results.targets[1]).toMatchObject({ segmentId: 4, pb: 140, held: true });
    expect(results.suspicious[0]).toMatchObject({ record: 90, implausible: true, held: false });
    expect(stravaReads()).toEqual([]);
  });

  it('uses the QOM when the Runner chose it', async () => {
    const session = await signIn();
    await saveSearchArea(database().db, session.id, AREA);
    await seedSegment(session.id, 1);
    await app.inject({
      method: 'PUT',
      url: '/api/preferences',
      cookies: session.cookies,
      payload: { recordGender: 'QOM' },
    });

    const results = (await getResults(session)).json<Results>();

    expect(results.recordGender).toBe('QOM');
    expect(ids(results.targets)).toEqual([1]);
  });

  it('drains the search’s work on each poll, so progress advances', async () => {
    const session = await signIn();
    await seedRuns(session.id, 30);
    const searched = await app.inject({
      method: 'POST',
      url: '/api/search',
      cookies: session.cookies,
      payload: AREA,
    });
    expect(searched.json<Results>().progress).toMatchObject({ status: 'running', runsChecked: 20 });

    const polled = (await getResults(session)).json<Results>();

    expect(polled.progress).toMatchObject({ status: 'done', runsChecked: 30, runsTotal: 30 });
    expect(polled.pending).toBe(false);
    expect(polled.targets).toHaveLength(30);
    expect(polled.knownCount).toBe(30);
  });

  it('says the work continues tomorrow once the Runner’s daily reads are used up', async () => {
    const session = await signIn();
    await seedRuns(session.id, 30);
    await app.inject({
      method: 'POST',
      url: '/api/search',
      cookies: session.cookies,
      payload: AREA,
    });
    await database().db.delete(stravaReadUsage);
    await setUsage(session.id, 'day', RUNNER_DAILY_READS);
    fetch.mockClear();

    const results = (await getResults(session)).json<Results>();

    expect(stravaReads()).toEqual([]);
    expect(results.progress).toMatchObject({ status: 'running', runsChecked: 20 });
    expect(results.pending).toBe(true);
    expect(results.budget.continuesTomorrow).toBe(true);
    expect(results.budget.pausedUntil).not.toBeNull();
  });

  it('only ever shows the Runner their own PBs', async () => {
    const alice = await signIn();
    const bob = await signIn();
    for (const runner of [alice, bob]) await saveSearchArea(database().db, runner.id, AREA);
    await seedSegment(alice.id, 1, { kom: '3:05', pb: 200 });
    await database()
      .db.insert(runnerSegments)
      .values({ runnerId: bob.id, segmentId: 1, viaRun: true, effortCount: 1, bestSeconds: 170 });
    // Only Alice knows this one.
    await seedSegment(alice.id, 2, { kom: '3:05', pb: 210 });

    const aliceRows = (await getResults(alice)).json<Results>().targets;
    const bobRows = (await getResults(bob)).json<Results>().targets;

    expect(aliceRows).toMatchObject([
      { segmentId: 1, pb: 200, held: false },
      { segmentId: 2, pb: 210 },
    ]);
    expect(bobRows).toMatchObject([{ segmentId: 1, pb: 170, held: true }]);
  });
});

describe('GET /api/debug/segments', () => {
  it('gives every Known Segment its list or the reason it’s in none, agreeing with the results', async () => {
    const session = await signIn();
    await seedArea(session.id);

    const debug = (await getDebug(session)).json<DebugSegments>();
    const results = (await getResults(session)).json<Results>();

    expect(debug.searchArea).toEqual(AREA);
    const bySegment = new Map(debug.segments.map((s) => [s.segmentId, s]));
    expect([...bySegment.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(
      Object.fromEntries(debug.segments.map((s) => [s.segmentId, s.list ?? s.reason])),
    ).toEqual({
      1: 'targets',
      2: 'nearestMisses',
      3: 'suspicious',
      4: 'targets',
      5: 'no-record',
      6: 'no-record',
      7: 'pending',
      8: 'outside-area',
      9: 'outside-area',
    });
    expect(bySegment.get(5)!.recordStatus).toBe('hazardous');
    expect(bySegment.get(6)!.recordStatus).toBe('missing');
    expect(bySegment.get(1)!.recordStatus).toBeNull();
    expect(bySegment.get(7)!.name).toBeNull();
    expect(bySegment.get(8)!.kmFromCentre).toBeCloseTo(5, 1);
    // Nearest first.
    const distances = debug.segments.map((s) => s.kmFromCentre);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));

    // Each list in the results is exactly the Segments the debug view puts in it.
    for (const list of ['targets', 'nearestMisses', 'suspicious'] as const) {
      expect(ids(results[list]).sort((a, b) => a - b)).toEqual(
        debug.segments
          .filter((s) => s.list === list)
          .map((s) => s.segmentId)
          .sort((a, b) => a - b),
      );
    }
    // And every Segment is in exactly one list or has exactly one reason.
    for (const segment of debug.segments) {
      expect((segment.list === null) !== (segment.reason === null)).toBe(true);
    }
  });

  it('with fewer than two Benchmarks, says there’s no prediction', async () => {
    const session = await signIn();
    await seedArea(session.id);
    await database().db.delete(benchmarks);

    const debug = (await getDebug(session)).json<DebugSegments>();
    const results = (await getResults(session)).json<Results>();

    const reasons = Object.fromEntries(
      debug.segments.map((s) => [s.segmentId, s.list ?? s.reason]),
    );
    // Held 4 stays a target; Implausible 3 stays Suspicious.
    expect(reasons).toMatchObject({
      1: 'no-prediction',
      2: 'no-prediction',
      3: 'suspicious',
      4: 'targets',
    });
    expect(ids(results.targets)).toEqual([4]);
    expect(results.enoughBenchmarks).toBe(false);
  });

  it('is 401 when signed out, and 404 without a Search Area', async () => {
    expect((await getDebug(undefined)).statusCode).toBe(401);
    expect((await getDebug(await signIn())).statusCode).toBe(404);
  });

  it('isn’t registered without debug routes (as in production)', async () => {
    const { app: productionLike } = buildTestApp(database(), { testRoutes: true });
    const login = await productionLike.inject({ method: 'POST', url: '/api/test/login' });
    const res = await productionLike.inject({
      url: '/api/debug/segments',
      cookies: { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toEqual({ error: 'no_search_area' });
    await productionLike.close();
  });
});
