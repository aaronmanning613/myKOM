// GET/POST/DELETE /api/mapped-areas through the API, with a fake Strava at fetch: starting a
// Mapped Area's crawl at mapping priority, its progress as the queue drains, removing it (and
// its pending work), and each Runner seeing only their own.
import {
  boundingBoxOf,
  encodePolyline,
  type LatLng,
  type MappedArea,
  type MappedAreaCreate,
  type MappedAreasResponse,
} from '@mykom/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { activities, crawls, runners, segments, stravaJobs } from '../db/schema.js';
import { enqueueJob, JOB_PRIORITY } from '../jobs/queue.js';
import { buildTestApp, useOwnTestDatabase } from '../test/app.js';

const { database } = useOwnTestDatabase();

const CENTRE = { lat: 45.42, lng: -75.69 };
const AREA: MappedAreaCreate = { label: 'Ottawa', ...CENTRE, radiusKm: 25 };

/** A point x metres east and y metres north of the centre. */
function at(x: number, y: number): LatLng {
  return {
    lat: CENTRE.lat + y / 111_320,
    lng: CENTRE.lng + x / (111_320 * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

let app: ReturnType<typeof buildTestApp>['app'];
let fetch: ReturnType<typeof buildTestApp>['fetch'];
let queue: ReturnType<typeof buildTestApp>['queue'];
let strava: ReturnType<typeof buildTestApp>['strava'];
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
  ({ app, fetch, queue, strava } = buildTestApp(database(), { testRoutes: true }));
});

afterAll(() => app.close());

beforeEach(async () => {
  const { db } = database();
  await db.delete(runners);
  await db.delete(segments);
  fetch.mockReset();
  runs = new Map();
  fetch.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const [, , , kind, rawId] = url.pathname.split('/');
    const id = Number(rawId);
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

async function signIn() {
  const res = await app.inject({ method: 'POST', url: '/api/test/login' });
  const { id } = res.json<{ id: number }>();
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { id, cookies: { [SESSION_COOKIE]: session } };
}
type Session = Awaited<ReturnType<typeof signIn>>;

const list = (session: Session | undefined) =>
  app.inject({ url: '/api/mapped-areas', cookies: session?.cookies });
const create = (session: Session | undefined, body: object = AREA) =>
  app.inject({
    method: 'POST',
    url: '/api/mapped-areas',
    cookies: session?.cookies,
    payload: body,
  });
const remove = (session: Session | undefined, id: number | string) =>
  app.inject({ method: 'DELETE', url: `/api/mapped-areas/${id}`, cookies: session?.cookies });

let nextRunId = 7_000;

/** Stored runs near the centre, 2 km apart in rows of their own, each with its own Segment. */
async function seedRuns(runnerId: number, count: number) {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const id = ++nextRunId;
    const y = -2000 + i * 2000;
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
    ids.push(id);
  }
  return ids;
}

/** Drains everything runnable, as the tick would. */
const drainAll = () =>
  queue.drain({
    deadline: new Date(Date.now() + 30_000),
    now: () => new Date(),
    strava,
    concurrency: 4,
  });

const jobsOf = (runnerId: number) =>
  database().db.select().from(stravaJobs).where(eq(stravaJobs.runnerId, runnerId));

describe('signed out', () => {
  it('refuses every endpoint', async () => {
    expect((await list(undefined)).statusCode).toBe(401);
    expect((await create(undefined)).statusCode).toBe(401);
    expect((await remove(undefined, 1)).statusCode).toBe(401);
  });
});

describe('POST /api/mapped-areas', () => {
  it.each([
    ['radius 5', { ...AREA, radiusKm: 5 }],
    ['radius 100', { ...AREA, radiusKm: 100 }],
    ['radius 25.5', { ...AREA, radiusKm: 25.5 }],
    ['no radius', { label: 'Ottawa', ...CENTRE }],
    ['a blank label', { ...AREA, label: '   ' }],
    ['a label too long', { ...AREA, label: 'x'.repeat(301) }],
    ['lat out of range', { ...AREA, lat: 91 }],
    ['lng out of range', { ...AREA, lng: -181 }],
  ])('rejects %s', async (_case, body) => {
    const session = await signIn();
    expect((await create(session, body)).statusCode).toBe(400);
    expect((await list(session)).json<MappedAreasResponse>().mappedAreas).toEqual([]);
  });

  it.each([10, 25, 50])('accepts radius %i', async (radiusKm) => {
    const session = await signIn();
    const res = await create(session, { ...AREA, radiusKm });
    expect(res.statusCode).toBe(201);
    expect(res.json<MappedArea>().radiusKm).toBe(radiusKm);
  });

  it('starts a mapping-priority crawl of the area without reading Strava', async () => {
    const session = await signIn();
    const runIds = await seedRuns(session.id, 3);

    const res = await create(session, { ...AREA, label: '  Ottawa  ' });

    expect(res.statusCode).toBe(201);
    const created = res.json<MappedArea>();
    expect(created).toMatchObject({
      label: 'Ottawa',
      ...CENTRE,
      radiusKm: 25,
      progress: { status: 'running', runsChecked: 0, runsTotal: 3, coverage: 0 },
    });
    expect(stravaReads()).toHaveLength(0);
    const [crawl] = await database()
      .db.select()
      .from(crawls)
      .where(eq(crawls.mappedAreaId, created.id));
    const jobs = await jobsOf(session.id);
    expect(jobs.map((job) => job.target).sort()).toEqual(runIds.sort());
    expect(jobs.every((job) => job.priority === JOB_PRIORITY.mapping)).toBe(true);
    expect(jobs.every((job) => job.crawlId === crawl!.id && job.status === 'pending')).toBe(true);
  });
});

describe('GET /api/mapped-areas', () => {
  it('lists the Runner’s Mapped Areas newest first with progress as the work drains', async () => {
    const session = await signIn();
    await seedRuns(session.id, 3);
    const first = (await create(session)).json<MappedArea>();
    const second = (
      await create(session, { ...AREA, label: 'Gatineau', radiusKm: 10 })
    ).json<MappedArea>();

    const before = (await list(session)).json<MappedAreasResponse>().mappedAreas;
    expect(before.map((area) => area.id)).toEqual([second.id, first.id]);
    expect(before[1]!.progress).toMatchObject({ status: 'running', runsTotal: 3, runsChecked: 0 });
    expect(typeof before[1]!.createdAt).toBe('string');

    await drainAll();

    // One job per run serves both crawls (de-duplication), and each Segment detail lands once.
    expect(stravaReads()).toHaveLength(6);
    const after = (await list(session)).json<MappedAreasResponse>().mappedAreas;
    expect(after[1]!.progress).toEqual({
      status: 'done',
      runsChecked: 3,
      runsTotal: 3,
      segmentsChecked: 3,
      segmentsTotal: 3,
      segmentsFound: 3,
      coverage: 1,
    });
    // The 10 km area only reaches the runs within it.
    expect(after[0]!.progress).toMatchObject({ status: 'done', runsTotal: 3, coverage: 1 });
  });

  it('shows an area with no runs through it as done', async () => {
    const session = await signIn();
    const created = (await create(session)).json<MappedArea>();
    expect(created.progress).toMatchObject({ status: 'done', runsTotal: 0, coverage: 1 });
  });
});

describe('DELETE /api/mapped-areas/:id', () => {
  it('removes the area and its pending jobs, so draining reads nothing', async () => {
    const session = await signIn();
    await seedRuns(session.id, 3);
    const created = (await create(session)).json<MappedArea>();

    const res = await remove(session, created.id);

    expect(res.statusCode).toBe(204);
    expect((await list(session)).json<MappedAreasResponse>().mappedAreas).toEqual([]);
    expect(await jobsOf(session.id)).toEqual([]);
    expect(
      await database().db.select().from(crawls).where(eq(crawls.mappedAreaId, created.id)),
    ).toEqual([]);
    await drainAll();
    expect(stravaReads()).toHaveLength(0);
  });

  it('keeps jobs other work shares or that are running, unlinked', async () => {
    const session = await signIn();
    const [shared, running, dropped] = await seedRuns(session.id, 3);
    const created = (await create(session)).json<MappedArea>();
    const { db } = database();
    // A new run's detail de-duplicated onto the crawl's job raises it above mapping priority.
    await enqueueJob(db, {
      kind: 'activity-detail',
      target: shared!,
      runnerId: session.id,
      priority: 'new-run',
    });
    await db.update(stravaJobs).set({ status: 'running' }).where(eq(stravaJobs.target, running!));

    expect((await remove(session, created.id)).statusCode).toBe(204);

    const left = await jobsOf(session.id);
    expect(left.map((job) => job.target).sort()).toEqual([shared, running].sort());
    expect(left.every((job) => job.crawlId === null)).toBe(true);
    expect(left.some((job) => job.target === dropped)).toBe(false);
  });

  it('is scoped to the signed-in Runner', async () => {
    const owner = await signIn();
    const other = await signIn();
    await seedRuns(owner.id, 2);
    const created = (await create(owner)).json<MappedArea>();

    expect((await list(other)).json<MappedAreasResponse>().mappedAreas).toEqual([]);
    expect((await remove(other, created.id)).statusCode).toBe(404);

    const still = (await list(owner)).json<MappedAreasResponse>().mappedAreas;
    expect(still.map((area) => area.id)).toEqual([created.id]);
    expect(await jobsOf(owner.id)).toHaveLength(2);
  });

  it('404s an unknown id and 400s a malformed one', async () => {
    const session = await signIn();
    expect((await remove(session, 999_999)).statusCode).toBe(404);
    expect((await remove(session, 'abc')).statusCode).toBe(400);
    expect((await remove(session, 0)).statusCode).toBe(400);
  });
});
