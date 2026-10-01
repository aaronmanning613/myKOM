// POST /api/search through the API, with a fake Strava at fetch: saving the Search Area, the
// results ranked from what's stored, the first burst and its limits, and the budget.
import {
  boundingBoxOf,
  encodePolyline,
  FIRST_BURST_RUNS,
  INTERACTIVE_READ_RESERVE,
  RUNNER_DAILY_READS,
  type LatLng,
  type Me,
  type Results,
  type SearchAreaResponse,
} from '@mykom/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import {
  activities,
  benchmarks,
  crawls,
  runnerSegments,
  runners,
  searchAreas,
  segments,
  stravaJobs,
  stravaReadUsage,
} from '../db/schema.js';
import { windowStart } from '../jobs/budget.js';
import { JOB_PRIORITY } from '../jobs/queue.js';
import { buildTestApp, useOwnTestDatabase } from '../test/app.js';

const { database } = useOwnTestDatabase();

const CENTRE = { lat: 45.42, lng: -75.69 };
const AREA = { label: 'Ottawa', ...CENTRE, radiusKm: 2 };

/** A point x metres east and y metres north of the centre. */
function at(x: number, y: number): LatLng {
  return {
    lat: CENTRE.lat + y / 111_320,
    lng: CENTRE.lng + x / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

let app: ReturnType<typeof buildTestApp>['app'];
let fetch: ReturnType<typeof buildTestApp>['fetch'];
// What the fake Strava holds: each run's route and Segments, each Segment, and the starred list.
let runs: Map<number, { route: LatLng[]; segmentIds: number[] }>;
let stravaSegments: Map<number, { start: LatLng; kom: string; athleteCount: number }>;
let starred: number[];

function segmentSummary(id: number) {
  const { start } = stravaSegments.get(id)!;
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
    starred: starred.includes(id),
  };
}

function runBody(id: number) {
  const run = runs.get(id)!;
  return {
    id,
    name: `Run ${id}`,
    type: 'Run',
    sport_type: 'Run',
    start_date: '2026-09-01T12:00:00Z',
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1500,
    map: { summary_polyline: encodePolyline(run.route) },
    segment_efforts: run.segmentIds.map((segmentId, i) => ({
      id: id * 1000 + i,
      activity: { id },
      name: `Segment ${segmentId}`,
      distance: 1000,
      elapsed_time: 240,
      moving_time: 240,
      start_date: '2026-09-01T12:10:00Z',
      kom_rank: null,
      achievements: [],
      segment: segmentSummary(segmentId),
    })),
  };
}

/** The Strava reads the fake answered, by path. */
const reads = (prefix: string) =>
  fetch.mock.calls
    .map(([input]) => new URL(input instanceof Request ? input.url : String(input)).pathname)
    .filter((path) => path.startsWith(`/api/v3${prefix}`));

beforeAll(() => {
  ({ app, fetch } = buildTestApp(database(), { testRoutes: true }));
});

afterAll(() => app.close());

beforeEach(async () => {
  const { db } = database();
  await db.delete(stravaReadUsage);
  await db.delete(runners);
  await db.delete(segments);
  fetch.mockReset();
  runs = new Map();
  stravaSegments = new Map();
  starred = [];
  fetch.mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const [, , , kind, id] = url.pathname.split('/');
    if (url.pathname === '/api/v3/segments/starred') {
      return Response.json(url.searchParams.get('page') === '1' ? starred.map(segmentSummary) : []);
    }
    if (kind === 'activities' && runs.has(Number(id))) return Response.json(runBody(Number(id)));
    const segment = stravaSegments.get(Number(id));
    if (kind === 'segments' && segment) {
      return Response.json({
        ...segmentSummary(Number(id)),
        total_elevation_gain: 0,
        athlete_count: segment.athleteCount,
        map: { polyline: '' },
        xoms: { kom: segment.kom, qom: segment.kom },
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

const postSearch = (session: Session | undefined, payload: object = AREA) =>
  app.inject({ method: 'POST', url: '/api/search', cookies: session?.cookies, payload });

let nextRunId = 1_000;

/**
 * Stores runs for the Runner (as the activity list would have), each an east-west line across
 * the area in its own 100 m row, crossing one new Segment of its own.
 */
async function seedRuns(runnerId: number, count: number, firstRow = 0) {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = ++nextRunId;
    const y = -1450 + (firstRow + i) * 100;
    const route = [at(-500, y), at(500, y)];
    const segmentId = id * 10;
    stravaSegments.set(segmentId, { start: at(0, y), kom: '3:05', athleteCount: 100 + i });
    runs.set(id, { route, segmentIds: [segmentId] });
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
    ids.push(id);
  }
  return ids;
}

/** A Known Segment with its details already stored (from an earlier search). */
async function seedStoredSegment(
  runnerId: number,
  id: number,
  start: LatLng,
  kom: string,
  polyline: string | null = null,
) {
  await database()
    .db.insert(segments)
    .values({
      id,
      name: `Stored ${id}`,
      activityType: 'Run',
      distance: 1000,
      averageGrade: 0,
      maximumGrade: 1,
      totalElevationGain: 0,
      startLat: start.lat,
      startLng: start.lng,
      polyline,
      komRaw: kom,
      qomRaw: kom,
      athleteCount: 5000,
      detailFetchedAt: new Date(),
    })
    .onConflictDoNothing();
  await database()
    .db.insert(runnerSegments)
    .values({ runnerId, segmentId: id, viaRun: true, effortCount: 1, bestSeconds: 200 });
}

async function setUsage(runnerId: number | null, window: '15min' | 'day', reads: number) {
  await database()
    .db.insert(stravaReadUsage)
    .values({ runnerId, window, windowStart: windowStart(window, new Date()), reads });
}

describe('POST /api/search', () => {
  it('is 401 when signed out', async () => {
    expect((await postSearch(undefined)).statusCode).toBe(401);
  });

  it.each([
    ['a radius no longer offered', { ...AREA, radiusKm: 25 }],
    ['a radius never offered', { ...AREA, radiusKm: 7 }],
    ['a zero radius', { ...AREA, radiusKm: 0 }],
    ['a fractional radius', { ...AREA, radiusKm: 1.5 }],
    ['a missing radius', { label: AREA.label, lat: AREA.lat, lng: AREA.lng }],
    ['a blank label', { ...AREA, label: '   ' }],
    ['a label that is too long', { ...AREA, label: 'x'.repeat(301) }],
    ['a latitude out of range', { ...AREA, lat: 90.1 }],
    ['a longitude out of range', { ...AREA, lng: -180.1 }],
  ])('rejects %s with 400, saving and reading nothing', async (_name, payload) => {
    const session = await signIn();
    const res = await postSearch(session, payload);
    expect(res.statusCode).toBe(400);
    const saved = await app.inject({ url: '/api/search-area', cookies: session.cookies });
    expect(saved.json<SearchAreaResponse>()).toEqual({ searchArea: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([1, 2, 5, 10])('accepts a %i km radius', async (radiusKm) => {
    const res = await postSearch(await signIn(), { ...AREA, radiusKm });
    expect(res.statusCode).toBe(200);
    expect(res.json<Results>().searchArea.radiusKm).toBe(radiusKm);
  });

  it('saves the Search Area (label trimmed) and marks the Runner onboarded', async () => {
    const session = await signIn();
    const me = async () =>
      (await app.inject({ url: '/api/me', cookies: session.cookies })).json<Me>();
    expect((await me()).onboarded).toBe(false);

    const res = await postSearch(session, { ...AREA, label: '  Ottawa ' });

    expect(res.json<Results>().searchArea).toEqual(AREA);
    const saved = await app.inject({ url: '/api/search-area', cookies: session.cookies });
    expect(saved.json<SearchAreaResponse>()).toEqual({ searchArea: AREA });
    expect((await me()).onboarded).toBe(true);
    const [runner] = await database().db.select().from(runners).where(eq(runners.id, session.id));
    const onboardedAt = runner!.onboardedAt;
    // A later search keeps the first onboarding time.
    await postSearch(session, { ...AREA, radiusKm: 5 });
    const [again] = await database().db.select().from(runners).where(eq(runners.id, session.id));
    expect(again!.onboardedAt).toEqual(onboardedAt);
  });

  it('returns the stored Segments ranked, plus what the first burst gathered, with progress', async () => {
    const session = await signIn();
    // From an earlier search: one Achievable and one just out of reach, plus one outside the area.
    await seedStoredSegment(session.id, 1, at(0, 100), '3:05');
    await seedStoredSegment(session.id, 2, at(100, 0), '2:50');
    await seedStoredSegment(session.id, 3, at(0, 5000), '3:05');
    await seedRuns(session.id, 3);

    const res = await postSearch(session);

    expect(res.statusCode).toBe(200);
    const results = res.json<Results>();
    expect(results.targets.map((row) => row.name)).toEqual([
      'Stored 1',
      // The burst's Segments, by Impressiveness.
      `Segment ${nextRunId * 10}`,
      `Segment ${(nextRunId - 1) * 10}`,
      `Segment ${(nextRunId - 2) * 10}`,
    ]);
    expect(results.targets[0]).toMatchObject({
      segmentId: 1,
      distance: 1000,
      averageGrade: 0,
      athleteCount: 5000,
      record: 185,
      predicted: { seconds: 180, confidence: 'high', reason: 'within-range' },
      pb: 200,
      held: false,
      implausible: false,
    });
    expect(results.targets[0]!.kmFromCentre).toBeCloseTo(0.1, 2);
    // Fewer than 5 Achievable: the one out of reach is a Nearest miss.
    expect(results.nearestMisses.map((row) => row.segmentId)).toEqual([2]);
    expect(results.suspicious).toEqual([]);
    expect(results).toMatchObject({
      recordGender: 'KOM',
      achievableCount: 4,
      knownCount: 5,
      enoughBenchmarks: true,
      progress: {
        status: 'done',
        runsChecked: 3,
        runsTotal: 3,
        segmentsChecked: 5,
        segmentsTotal: 5,
        segmentsFound: 3,
      },
      pending: false,
      budget: { continuesTomorrow: false, pausedUntil: null },
    });
    // Stored details weren't read again.
    expect(reads('/segments/').filter((path) => path.endsWith('/segments/1'))).toEqual([]);
    expect(reads('/activities')).toHaveLength(3);
  });

  it('gives each row its start and stored polyline, reading nothing more for geometry', async () => {
    // The same search twice, by two Runners: stored Segments with and without polylines.
    const search = async (firstId: number, withPolylines: boolean) => {
      const session = await signIn();
      const route = [at(0, 100), at(0, 600), at(200, 900)];
      await seedStoredSegment(
        session.id,
        firstId,
        at(0, 100),
        '3:05',
        withPolylines ? encodePolyline(route) : null,
      );
      await seedStoredSegment(session.id, firstId + 1, at(100, 0), '2:50');
      await seedRuns(session.id, 2, firstId % 10);
      fetch.mockClear();
      const results = (await postSearch(session)).json<Results>();
      return { results, route, calls: fetch.mock.calls.length };
    };

    const without = await search(10, false);
    const withPolylines = await search(20, true);

    const stored = withPolylines.results.targets.find((row) => row.segmentId === 20)!;
    expect(stored.start).toEqual(at(0, 100));
    expect(stored.polyline).toBe(encodePolyline(withPolylines.route));
    expect(without.results.targets.find((row) => row.segmentId === 10)!.polyline).toBeNull();
    const miss = withPolylines.results.nearestMisses.find((row) => row.segmentId === 21)!;
    expect(miss).toMatchObject({ start: at(100, 0), polyline: null });
    // The burst's Segments came with an empty `map.polyline`, so they have none.
    expect(
      withPolylines.results.targets.filter((row) => row.segmentId > 1000).map((r) => r.polyline),
    ).toEqual([null, null]);
    expect(withPolylines.calls).toBe(without.calls);
  });

  it('includes starred Segments, read on each search', async () => {
    const session = await signIn();
    stravaSegments.set(77, { start: at(200, 200), kom: '3:10', athleteCount: 9 });
    starred = [77];

    const results = (await postSearch(session)).json<Results>();

    expect(reads('/segments/starred')).toHaveLength(1);
    expect(results.targets).toMatchObject([{ segmentId: 77, pb: null, held: false }]);
  });

  it('goes on without the starred Segments when Strava fails to list them', async () => {
    const session = await signIn();
    await seedStoredSegment(session.id, 1, at(0, 100), '3:05');
    const answer = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) =>
      String(input).includes('/segments/starred')
        ? Response.json({ message: 'Oops' }, { status: 503 })
        : answer(input, init),
    );

    const res = await postSearch(session);

    expect(res.statusCode).toBe(200);
    expect(res.json<Results>().targets.map((row) => row.segmentId)).toEqual([1]);
  });

  it('spends a first burst of about 20 runs, leaving the rest pending', async () => {
    const session = await signIn();
    await seedRuns(session.id, 30);

    const results = (await postSearch(session)).json<Results>();

    expect(reads('/activities')).toHaveLength(FIRST_BURST_RUNS);
    expect(results.progress).toMatchObject({
      status: 'running',
      runsChecked: FIRST_BURST_RUNS,
      runsTotal: 30,
    });
    expect(results.pending).toBe(true);
    expect(results.targets.length).toBe(results.progress!.segmentsChecked);
    const pending = await database()
      .db.select()
      .from(stravaJobs)
      .where(and(eq(stravaJobs.runnerId, session.id), eq(stravaJobs.status, 'pending')));
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((job) => job.priority === JOB_PRIORITY.search)).toBe(true);
  });

  it('leaves other Runners’ jobs alone', async () => {
    const other = await signIn();
    const [otherRun] = await seedRuns(other.id, 1);
    await database().db.insert(stravaJobs).values({
      kind: 'activity-detail',
      target: otherRun!,
      runnerId: other.id,
      priority: JOB_PRIORITY.search,
    });
    const session = await signIn();
    await seedRuns(session.id, 2, 5);

    await postSearch(session);

    expect(reads(`/activities/${otherRun}`)).toEqual([]);
  });

  it('stops the burst at the interactive reserve of the 15-minute window', async () => {
    const session = await signIn();
    await seedRuns(session.id, 20);
    // The starred read takes it to 81; background work may use 9 more before the reserve.
    await setUsage(null, '15min', 100 - INTERACTIVE_READ_RESERVE - 10);

    const results = (await postSearch(session)).json<Results>();

    const jobReads = reads('/activities').length + reads('/segments/').length - 1;
    expect(jobReads).toBe(9);
    const [window] = await database()
      .db.select()
      .from(stravaReadUsage)
      .where(and(isNull(stravaReadUsage.runnerId), eq(stravaReadUsage.window, '15min')));
    expect(window!.reads).toBe(100 - INTERACTIVE_READ_RESERVE);
    expect(results.pending).toBe(true);
    expect(results.budget.continuesTomorrow).toBe(false);
    expect(results.budget.pausedUntil).not.toBeNull();
  });

  it('stops at the Runner’s daily reads, and says it continues tomorrow', async () => {
    const session = await signIn();
    await seedRuns(session.id, 20);
    // The starred read takes it to 496: 4 more for the burst.
    await setUsage(session.id, 'day', RUNNER_DAILY_READS - 5);

    const results = (await postSearch(session)).json<Results>();

    const jobReads = reads('/activities').length + reads('/segments/').length - 1;
    expect(jobReads).toBe(4);
    expect(results.budget.continuesTomorrow).toBe(true);
    expect(results.pending).toBe(true);
  });

  it('ends the previous search’s crawl, demoting its pending jobs', async () => {
    const session = await signIn();
    await seedRuns(session.id, 30);
    await postSearch(session);
    const [first] = await database()
      .db.select()
      .from(crawls)
      .where(eq(crawls.runnerId, session.id));

    // Somewhere else, where the Runner has no runs.
    await postSearch(session, { ...AREA, lat: 46.8, lng: -71.2 });

    const all = await database().db.select().from(crawls).where(eq(crawls.runnerId, session.id));
    expect(all.find((crawl) => crawl.id === first!.id)?.status).toBe('done');
    const leftOver = await database()
      .db.select()
      .from(stravaJobs)
      .where(and(eq(stravaJobs.crawlId, first!.id), eq(stravaJobs.status, 'pending')));
    expect(leftOver.length).toBeGreaterThan(0);
    expect(leftOver.every((job) => job.priority === JOB_PRIORITY.mapping)).toBe(true);
  });

  it('with fewer than two Benchmarks, says so and predicts nothing', async () => {
    const session = await signIn();
    await database().db.delete(benchmarks).where(eq(benchmarks.runnerId, session.id));
    await seedStoredSegment(session.id, 1, at(0, 100), '3:05');

    const results = (await postSearch(session)).json<Results>();

    expect(results).toMatchObject({ enoughBenchmarks: false, targets: [], knownCount: 1 });
  });

  it('only ever shows the Runner their own PBs', async () => {
    const alice = await signIn();
    const bob = await signIn();
    await seedStoredSegment(alice.id, 1, at(0, 100), '3:05');
    await database()
      .db.insert(runnerSegments)
      .values({ runnerId: bob.id, segmentId: 1, viaRun: true, effortCount: 1, bestSeconds: 170 });

    const aliceRows = (await postSearch(alice)).json<Results>().targets;
    const bobRows = (await postSearch(bob)).json<Results>().targets;

    expect(aliceRows).toMatchObject([{ segmentId: 1, pb: 200, held: false }]);
    expect(bobRows).toMatchObject([{ segmentId: 1, pb: 170, held: true }]);
  });
});

describe('the Search Area table', () => {
  it('keeps one row per Runner', async () => {
    const session = await signIn();
    await postSearch(session);
    await postSearch(session, { ...AREA, label: 'Elsewhere', radiusKm: 1 });
    const rows = await database()
      .db.select()
      .from(searchAreas)
      .where(eq(searchAreas.runnerId, session.id));
    expect(rows).toMatchObject([{ label: 'Elsewhere', radiusKm: 1 }]);
  });
});
