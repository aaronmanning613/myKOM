import { vdotOf } from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest';
import { STATE_COOKIE } from '../auth/routes.js';
import { SESSION_COOKIE } from '../auth/session.js';
import {
  activities,
  benchmarks,
  fitnessProfiles,
  runnerSegments,
  runners,
  segmentEfforts,
  segments,
} from '../db/schema.js';
import { refreshRunSegments } from '../jobs/handlers.js';
import { STRAVA_PAGE_SIZE, STRAVA_TOKEN_URL, type StravaClient } from '../strava/client.js';
import { buildTestApp, randomAthleteId, useTestDatabase } from '../test/app.js';
import { syncActivities } from './activities.js';

const database = useTestDatabase();
const { db } = database;
const athleteIds: number[] = [];

let app: FastifyInstance;
let fetch: Mock<typeof globalThis.fetch>;
let strava: StravaClient;

beforeEach(() => {
  ({ app, fetch, strava } = buildTestApp(database));
});

afterEach(() => app.close());

afterAll(async () => {
  if (athleteIds.length) {
    await db.delete(runners).where(inArray(runners.stravaAthleteId, athleteIds));
  }
});

type Body = Record<string, unknown>;

// Activity and Segment ids of this file's own, so they can't clash with other files' rows.
const base = 900_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1_000;
let nextId = base;
const newId = () => ++nextId;

function activity(
  id: number,
  startDate: string,
  { sportType = 'Run', name = `Run ${id}`, distance = 10_000, movingTime = 2_400 } = {},
): Body {
  return {
    id,
    name,
    type: sportType,
    sport_type: sportType,
    start_date: startDate,
    distance,
    moving_time: movingTime,
    elapsed_time: movingTime + 60,
    // Google's polyline example: (38.5, -120.2) to (40.7, -120.95).
    map: { summary_polyline: '_p~iF~ps|U_ulLnnqC' },
  };
}

function starredSegment(id: number, activityType = 'Run'): Body {
  return {
    id,
    name: `Segment ${id}`,
    activity_type: activityType,
    distance: 800,
    average_grade: 1,
    maximum_grade: 3,
    elevation_high: 60,
    elevation_low: 50,
    start_latlng: [45.42, -75.69],
    end_latlng: [45.43, -75.7],
    hazardous: false,
    starred: true,
  };
}

/**
 * A fake Strava: the token exchange for `athleteId`, the activity list in pages, and the
 * starred Segments. Records each activity-list URL it was asked for.
 */
function fakeStrava({ athleteId = 0, activityPages = [[]] as Body[][], starred = [] as Body[] }) {
  const listRequests: URL[] = [];
  fetch.mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === STRAVA_TOKEN_URL) {
      return Response.json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_at: 2_000_000_000,
        athlete: { id: athleteId, firstname: 'Paula', sex: 'F', profile: null, summit: false },
      });
    }
    const page = Number(url.searchParams.get('page'));
    if (url.pathname === '/api/v3/athlete/activities') {
      listRequests.push(url);
      return Response.json(activityPages[page - 1] ?? []);
    }
    if (url.pathname === '/api/v3/segments/starred') {
      return Response.json(page === 1 ? starred : []);
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  });
  return { listRequests };
}

/** Signs in through Strava's callback like a browser would. */
async function signIn(athleteId: number) {
  athleteIds.push(athleteId);
  const start = await app.inject({
    method: 'GET',
    url: '/api/auth/strava',
    headers: { host: 'localhost:5173' },
  });
  const cookie = start.cookies.find((c) => c.name === STATE_COOKIE)!;
  const state = new URL(start.headers.location!).searchParams.get('state')!;
  const res = await app.inject({
    method: 'GET',
    url: `/api/auth/strava/callback?${new URLSearchParams({ code: 'c', state, scope: 'read,activity:read_all' })}`,
    cookies: { [STATE_COOKIE]: cookie.value },
  });
  const [runner] = await db.select().from(runners).where(eq(runners.stravaAthleteId, athleteId));
  return { res, runner: runner!, session: res.cookies.find((c) => c.name === SESSION_COOKIE) };
}

const storedRuns = (runnerId: number) =>
  db
    .select()
    .from(activities)
    .where(eq(activities.runnerId, runnerId))
    .orderBy(activities.startDate);

describe('first sign-in', () => {
  it('stores every run from every page and links the starred running Segments', async () => {
    const athleteId = randomAthleteId();
    const fullPage = Array.from({ length: STRAVA_PAGE_SIZE }, (_, i) =>
      activity(newId(), new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString()),
    );
    const trail = activity(newId(), '2024-06-01T08:00:00Z', { sportType: 'TrailRun' });
    const ride = activity(newId(), '2024-06-02T08:00:00Z', { sportType: 'Ride' });
    const [runSegment, rideSegment] = [newId(), newId()];
    const { listRequests } = fakeStrava({
      athleteId,
      activityPages: [fullPage, [trail, ride]],
      starred: [starredSegment(runSegment), starredSegment(rideSegment, 'Ride')],
    });

    const { res, runner, session } = await signIn(athleteId);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(session).toBeDefined();
    expect(listRequests.map((url) => url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(listRequests[0]!.searchParams.has('after')).toBe(false);
    const runs = await storedRuns(runner.id);
    expect(runs).toHaveLength(STRAVA_PAGE_SIZE + 1);
    expect(runs.map((run) => run.id)).not.toContain(ride.id);
    const stored = runs.find((run) => run.id === trail.id)!;
    expect(stored).toMatchObject({
      name: `Run ${trail.id}`,
      sportType: 'TrailRun',
      distance: 10_000,
      movingTime: 2_400,
      summaryPolyline: '_p~iF~ps|U_ulLnnqC',
      detailFetchedAt: null,
    });
    expect(stored.minLat).toBeCloseTo(38.5);
    expect(stored.maxLat).toBeCloseTo(40.7);
    expect(runner.activitiesCheckedAt).not.toBeNull();
    const links = await db
      .select()
      .from(runnerSegments)
      .where(eq(runnerSegments.runnerId, runner.id));
    expect(links).toEqual([
      expect.objectContaining({ segmentId: runSegment, viaStarred: true, viaRun: false }),
    ]);
    const [segment] = await db.select().from(segments).where(eq(segments.id, runSegment));
    expect(segment).toMatchObject({ name: `Segment ${runSegment}`, detailFetchedAt: null });
  });

  it('applies the Fitness Profile generated from the runs', async () => {
    const athleteId = randomAthleteId();
    const race = activity(newId(), '2026-06-01T08:00:00Z', { distance: 10_000, movingTime: 2_400 });
    fakeStrava({ athleteId, activityPages: [[race]] });

    const { runner } = await signIn(athleteId);

    const [profile] = await db
      .select()
      .from(fitnessProfiles)
      .where(eq(fitnessProfiles.runnerId, runner.id));
    expect(profile).toMatchObject({ sourceActivityIds: [race.id], suggestedVdot: null });
    expect(profile!.vdot).toBeCloseTo(vdotOf(10_000, 2_400));
    const rows = await db.select().from(benchmarks).where(eq(benchmarks.runnerId, runner.id));
    expect(rows).toHaveLength(13);
    expect(rows.find((b) => b.distance === '10k')).toMatchObject({
      seconds: 2_400,
      source: 'generated',
      generatedSeconds: 2_400,
    });
  });

  it('does not read the activity list again on a later sign-in', async () => {
    const athleteId = randomAthleteId();
    const first = fakeStrava({
      athleteId,
      activityPages: [[activity(newId(), '2026-01-01T08:00:00Z')]],
    });
    await signIn(athleteId);
    expect(first.listRequests).toHaveLength(1);

    const second = fakeStrava({ athleteId });
    const { res } = await signIn(athleteId);

    expect(res.headers.location).toBe('/');
    expect(second.listRequests).toHaveLength(0);
  });

  it('still signs in when Strava fails, and tries again on the next sign-in', async () => {
    const athleteId = randomAthleteId();
    fetch.mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === STRAVA_TOKEN_URL) {
        return Response.json({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_at: 2_000_000_000,
          athlete: { id: athleteId, firstname: 'Paula', sex: 'F', profile: null, summit: false },
        });
      }
      return Response.json({ message: 'unavailable' }, { status: 503 });
    });

    const failed = await signIn(athleteId);

    expect(failed.res.headers.location).toBe('/');
    expect(failed.session).toBeDefined();
    expect(failed.runner.activitiesCheckedAt).toBeNull();

    const run = activity(newId(), '2026-01-01T08:00:00Z');
    const retry = fakeStrava({ athleteId, activityPages: [[run]] });
    const { runner } = await signIn(athleteId);

    expect(retry.listRequests).toHaveLength(1);
    expect((await storedRuns(runner.id)).map((r) => r.id)).toEqual([run.id]);
  });
});

describe('syncActivities', () => {
  /** Signs a Runner in with these runs already on Strava, returning their id. */
  async function runnerWith(runs: Body[]) {
    const athleteId = randomAthleteId();
    fakeStrava({ athleteId, activityPages: [runs] });
    const { runner } = await signIn(athleteId);
    return runner.id;
  }

  it('new: asks only for runs after the latest stored one, and keeps the rest', async () => {
    const older = activity(newId(), '2026-09-01T08:00:00Z');
    const latest = activity(newId(), '2026-09-20T07:30:00Z');
    const runnerId = await runnerWith([latest, older]);
    const added = activity(newId(), '2026-09-28T18:00:00Z');
    const alsoAdded = activity(newId(), '2026-09-27T18:00:00Z');
    const { listRequests } = fakeStrava({ activityPages: [[alsoAdded, added]] });
    const now = new Date('2026-09-29T12:00:00Z');

    const result = await syncActivities({ db, strava }, runnerId, 'new', now);

    expect(listRequests).toHaveLength(1);
    expect(listRequests[0]!.searchParams.get('after')).toBe(
      String(Date.parse('2026-09-20T07:30:00Z') / 1000),
    );
    expect(result).toEqual({ newRunIds: [added.id, alsoAdded.id], removedRunIds: [] });
    expect((await storedRuns(runnerId)).map((run) => run.id)).toEqual([
      older.id,
      latest.id,
      alsoAdded.id,
      added.id,
    ]);
    const [runner] = await db.select().from(runners).where(eq(runners.id, runnerId));
    expect(runner!.activitiesCheckedAt).toEqual(now);
  });

  it('new: with no stored runs, reads the whole list', async () => {
    const runnerId = await runnerWith([]);
    const run = activity(newId(), '2026-09-28T18:00:00Z');
    const { listRequests } = fakeStrava({ activityPages: [[run]] });

    const result = await syncActivities({ db, strava }, runnerId, 'new');

    expect(listRequests[0]!.searchParams.has('after')).toBe(false);
    expect(result.newRunIds).toEqual([run.id]);
  });

  it('full: removes a deleted run and its efforts, recomputing the Segment bests', async () => {
    const kept = activity(newId(), '2026-09-01T08:00:00Z');
    const deleted = activity(newId(), '2026-09-10T08:00:00Z');
    const runnerId = await runnerWith([deleted, kept]);
    // Segment `shared` was run on both runs (fastest on the deleted one); `only` on the deleted
    // run; `starred` on the deleted run but also starred.
    const [shared, only, starred] = [newId(), newId(), newId()];
    await db.insert(segments).values(
      [shared, only, starred].map((id) => ({
        id,
        name: `Segment ${id}`,
        distance: 800,
        startLat: 45.42,
        startLng: -75.69,
      })),
    );
    await db
      .insert(segmentEfforts)
      .values([
        effortRow(runnerId, kept.id as number, shared, 200, '2026-09-01T08:10:00Z'),
        effortRow(runnerId, deleted.id as number, shared, 180, '2026-09-10T08:10:00Z', 3),
        effortRow(runnerId, deleted.id as number, only, 100, '2026-09-10T08:20:00Z'),
        effortRow(runnerId, deleted.id as number, starred, 90, '2026-09-10T08:30:00Z'),
      ]);
    await db.insert(runnerSegments).values({ runnerId, segmentId: starred, viaStarred: true });
    await refreshRunSegments(db, runnerId, [shared, only, starred]);
    await db
      .update(activities)
      .set({ detailFetchedAt: new Date('2026-09-02T00:00:00Z') })
      .where(eq(activities.id, kept.id as number));
    const edited = { ...kept, name: 'Renamed on Strava', moving_time: 2_300 };
    fakeStrava({ activityPages: [[edited]] });

    const result = await syncActivities({ db, strava }, runnerId, 'full');

    expect(result).toEqual({ newRunIds: [], removedRunIds: [deleted.id] });
    const runs = await storedRuns(runnerId);
    expect(runs).toEqual([
      expect.objectContaining({
        id: kept.id,
        name: 'Renamed on Strava',
        movingTime: 2_300,
        detailFetchedAt: new Date('2026-09-02T00:00:00Z'),
      }),
    ]);
    const efforts = await db
      .select({ activityId: segmentEfforts.activityId })
      .from(segmentEfforts)
      .where(eq(segmentEfforts.runnerId, runnerId));
    expect(efforts).toEqual([{ activityId: kept.id }]);
    const links = await db
      .select()
      .from(runnerSegments)
      .where(eq(runnerSegments.runnerId, runnerId))
      .orderBy(runnerSegments.segmentId);
    expect(links).toEqual([
      expect.objectContaining({
        segmentId: shared,
        viaRun: true,
        effortCount: 1,
        bestSeconds: 200,
        bestDate: new Date('2026-09-01T08:10:00Z'),
        topTenHint: false,
      }),
      expect.objectContaining({
        segmentId: starred,
        viaRun: false,
        viaStarred: true,
        effortCount: 0,
        bestSeconds: null,
      }),
    ]);
    // The shared Segment rows stay.
    expect(await db.select().from(segments).where(eq(segments.id, only))).toHaveLength(1);
  });

  it('full: drops a run that is no longer a run, and keeps other Runners’ runs', async () => {
    const run = activity(newId(), '2026-09-01T08:00:00Z');
    const runnerId = await runnerWith([run]);
    const otherRun = activity(newId(), '2026-09-02T08:00:00Z');
    const otherId = await runnerWith([otherRun]);
    fakeStrava({ activityPages: [[{ ...run, type: 'Ride', sport_type: 'Ride' }]] });

    const result = await syncActivities({ db, strava }, runnerId, 'full');

    expect(result.removedRunIds).toEqual([run.id]);
    expect(await storedRuns(runnerId)).toEqual([]);
    expect(
      await db
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.runnerId, otherId)),
    ).toEqual([{ id: otherRun.id }]);
  });
});

function effortRow(
  runnerId: number,
  activityId: number,
  segmentId: number,
  elapsedTime: number,
  startDate: string,
  komRank: number | null = null,
) {
  return {
    id: BigInt(newId()),
    runnerId,
    activityId,
    segmentId,
    elapsedTime,
    startDate: new Date(startDate),
    komRank,
  };
}
