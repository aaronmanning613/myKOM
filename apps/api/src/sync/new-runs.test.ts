// New runs through the API: the visit check and its throttle, new-run jobs, Fitness Profile
// suggestions (apply, dismiss, shown again) and Resync my runs.
import { benchmarksFromVdot, type FitnessProfile, type Me } from '@mykom/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { activities, runners, stravaJobs } from '../db/schema.js';
import { JOB_PRIORITY } from '../jobs/queue.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';

const database = useTestDatabase();
const { db } = database;
const { app, fetch } = buildTestApp(database, { testRoutes: true });
const runnerIds: number[] = [];

afterAll(async () => {
  await app.close();
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
});

const HOUR = 60 * 60 * 1000;

// Strava activity ids of this file's own, so they can't clash with other files' rows.
let nextActivityId = 700_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1_000;

/** A Strava activity summary, as the activity list returns it. */
function run(name: string, startDate: string, distance: number, movingTime: number) {
  return {
    id: ++nextActivityId,
    name,
    type: 'Run',
    sport_type: 'Run',
    start_date: startDate,
    distance,
    moving_time: movingTime,
    elapsed_time: movingTime + 120,
    map: { summary_polyline: '' },
  };
}
type Run = ReturnType<typeof run>;

// The test account: marathon 2:21:03 and 10K 30:39 give VDOT 71.1.
const marathon = () => run('Toronto Waterfront', '2026-05-03T13:00:00Z', 42_195, 8_463);
const tenK = () => run('Canada Day 10K', '2026-07-01T12:00:00Z', 10_000, 1_839);

/**
 * Strava's activity list holds `runs`, honouring `after`. Returns the list URLs asked for.
 * `status` makes every list request fail with it instead.
 */
function onStrava(runs: Run[], status?: number) {
  const listRequests: URL[] = [];
  fetch.mockReset();
  fetch.mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/api/v3/athlete/activities') {
      listRequests.push(url);
      if (status) return Response.json({ message: 'Nope' }, { status });
      const after = Number(url.searchParams.get('after') ?? 0) * 1000;
      const page = url.searchParams.get('page') === '1' ? runs : [];
      return Response.json(page.filter((r) => Date.parse(r.start_date) > after));
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  });
  return listRequests;
}

/** Signs in a new Runner (their runs count as just checked) and returns their session. */
async function signIn() {
  const res = await app.inject({ method: 'POST', url: '/api/test/login' });
  const { id } = res.json<{ id: number }>();
  runnerIds.push(id);
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { id, cookies: { [SESSION_COOKIE]: session } };
}
type Session = Awaited<ReturnType<typeof signIn>>;

const get = (session: Session | undefined, url: string) =>
  app.inject({ method: 'GET', url, cookies: session?.cookies });
const post = (session: Session | undefined, url: string, payload?: object) =>
  app.inject({ method: 'POST', url, cookies: session?.cookies, payload });
const me = async (session: Session) => (await get(session, '/api/me')).json<Me>();
const profileOf = async (session: Session) =>
  (await get(session, '/api/fitness-profile')).json<FitnessProfile>();
const suggestion = (session: Session, action: string) =>
  post(session, '/api/fitness-profile/suggestion', { action });

/** Makes the Runner's last new-run check `hoursAgo` hours old. */
async function checkedHoursAgo(session: Session, hoursAgo: number) {
  await db
    .update(runners)
    .set({ activitiesCheckedAt: new Date(Date.now() - hoursAgo * HOUR) })
    .where(eq(runners.id, session.id));
}

/**
 * A Runner whose applied generation came from the test account's marathon and 10K, just
 * checked, with no jobs queued.
 */
async function generatedRunner() {
  const session = await signIn();
  onStrava([tenK(), marathon()]);
  await post(session, '/api/fitness-profile/regenerate');
  await db.delete(stravaJobs).where(eq(stravaJobs.runnerId, session.id));
  return session;
}

const valuesOf = (profile: FitnessProfile) =>
  Object.fromEntries(profile.benchmarks.map((b) => [b.distance, b]));

const newRunJobs = (runnerId: number) =>
  db
    .select({ target: stravaJobs.target, priority: stravaJobs.priority })
    .from(stravaJobs)
    .where(and(eq(stravaJobs.runnerId, runnerId), eq(stravaJobs.kind, 'activity-detail')));

describe('the visit check', () => {
  it('reads new runs only once the last check is over 3 hours old', async () => {
    const session = await signIn();
    const listRequests = onStrava([]);

    await me(session);
    await checkedHoursAgo(session, 2.9);
    await me(session);
    expect(listRequests).toHaveLength(0);

    await checkedHoursAgo(session, 3.1);
    await me(session);
    expect(listRequests).toHaveLength(1);
    const [runner] = await db.select().from(runners).where(eq(runners.id, session.id));
    expect(Date.now() - runner!.activitiesCheckedAt!.getTime()).toBeLessThan(HOUR);

    // Any authenticated request counts, and the next one within 3 hours reads nothing.
    await get(session, '/api/search-area');
    expect(listRequests).toHaveLength(1);
  });

  it('runs once for the concurrent requests of a visit', async () => {
    const session = await signIn();
    await checkedHoursAgo(session, 5);
    const listRequests = onStrava([]);

    const replies = await Promise.all([
      get(session, '/api/me'),
      get(session, '/api/fitness-profile'),
      get(session, '/api/search-area'),
    ]);

    expect(replies.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(listRequests).toHaveLength(1);
  });

  it('asks only for runs after the latest stored one and queues their details', async () => {
    const session = await generatedRunner();
    const [older, newer] = [
      run('Tempo', '2026-09-20T10:00:00Z', 8_000, 1_800),
      run('Long run', '2026-09-27T10:00:00Z', 25_000, 6_000),
    ];
    const listRequests = onStrava([tenK(), marathon(), older, newer]);
    await checkedHoursAgo(session, 4);

    await me(session);

    expect(listRequests[0]!.searchParams.get('after')).toBe(
      String(Date.parse('2026-07-01T12:00:00Z') / 1000),
    );
    const stored = await db.select().from(activities).where(eq(activities.runnerId, session.id));
    expect(stored.map((a) => a.id)).toEqual(expect.arrayContaining([older.id, newer.id]));
    expect(stored).toHaveLength(4);
    expect(await newRunJobs(session.id)).toEqual(
      expect.arrayContaining([
        { target: newer.id, priority: JOB_PRIORITY['new-run'] },
        { target: older.id, priority: JOB_PRIORITY['new-run'] },
      ]),
    );
    expect(await newRunJobs(session.id)).toHaveLength(2);
  });

  it("doesn't fail the request when Strava can't be reached", async () => {
    const session = await signIn();
    await checkedHoursAgo(session, 5);
    const listRequests = onStrava([], 503);

    const res = await get(session, '/api/me');

    expect(res.statusCode).toBe(200);
    expect(listRequests).toHaveLength(1);
  });

  it('signs out and deletes a Runner who revoked access on Strava', async () => {
    const session = await signIn();
    await checkedHoursAgo(session, 5);
    onStrava([], 401);

    const res = await get(session, '/api/fitness-profile');

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'signed_out' });
    expect(await db.select().from(runners).where(eq(runners.id, session.id))).toEqual([]);
  });
});

describe('suggestions', () => {
  // A 14:00 5K scores well above the applied VDOT 71.1.
  const fastFiveK = () => run('Parkrun PB', '2026-09-26T13:00:00Z', 5_000, 840);

  it('suggests a new generation from new runs without changing any Benchmark', async () => {
    const session = await generatedRunner();
    const before = await profileOf(session);
    const race = fastFiveK();
    onStrava([race]);
    await checkedHoursAgo(session, 4);

    const summary = (await me(session)).suggestion;

    expect(summary).toMatchObject({
      appliedVdot: before.generation!.vdot,
      source: { activityId: race.id, name: 'Parkrun PB', benchmark: '5k' },
    });
    expect(summary!.vdot).toBeGreaterThan(before.generation!.vdot);
    const after = await profileOf(session);
    expect(after.benchmarks).toEqual(before.benchmarks);
    expect(after.generation).toEqual(before.generation);
    expect(after.suggestion).toMatchObject({ vdot: summary!.vdot });
    expect(after.suggestion!.sources[0]!.activityId).toBe(race.id);
    expect(after.suggestion!.benchmarks).toHaveLength(13);
  });

  it('suggests nothing when the new runs change no value', async () => {
    const session = await generatedRunner();
    onStrava([run('Easy jog', '2026-09-20T10:00:00Z', 8_000, 3_000)]);
    await checkedHoursAgo(session, 4);

    expect((await me(session)).suggestion).toBeNull();
    expect((await profileOf(session)).suggestion).toBeNull();
  });

  it('suggests nothing when every Benchmark is pinned', async () => {
    const session = await generatedRunner();
    const pinned = (await profileOf(session)).benchmarks.map((b) => ({
      distance: b.distance,
      seconds: b.seconds + 1,
    }));
    await app.inject({
      method: 'PUT',
      url: '/api/fitness-profile',
      cookies: session.cookies,
      payload: { benchmarks: pinned },
    });
    onStrava([fastFiveK()]);
    await checkedHoursAgo(session, 4);

    expect((await me(session)).suggestion).toBeNull();
  });

  it('suggests a first profile to a Runner who had none', async () => {
    const session = await signIn();
    await checkedHoursAgo(session, 5);
    onStrava([fastFiveK()]);

    expect((await me(session)).suggestion).toMatchObject({ appliedVdot: null });
    expect((await profileOf(session)).benchmarks).toEqual([]);
  });

  it('Apply updates the unpinned Benchmarks and leaves the pinned ones', async () => {
    const session = await generatedRunner();
    const current = await profileOf(session);
    const tenKPin = valuesOf(current)['10k']!.seconds + 30;
    await app.inject({
      method: 'PUT',
      url: '/api/fitness-profile',
      cookies: session.cookies,
      payload: {
        benchmarks: current.benchmarks.map((b) => ({
          distance: b.distance,
          seconds: b.distance === '10k' ? tenKPin : b.seconds,
        })),
      },
    });
    onStrava([fastFiveK()]);
    await checkedHoursAgo(session, 4);
    const suggested = (await me(session)).suggestion!;

    const res = await suggestion(session, 'apply');

    expect(res.statusCode).toBe(200);
    const applied = res.json<FitnessProfile>();
    expect(applied.suggestion).toBeNull();
    expect(applied.generation!.vdot).toBe(suggested.vdot);
    const values = valuesOf(applied);
    const suggestedValues = new Map(
      benchmarksFromVdot(suggested.vdot).map((b) => [b.distance, b.seconds]),
    );
    expect(values['10k']).toMatchObject({
      seconds: tenKPin,
      source: 'runner',
      generatedSeconds: suggestedValues.get('10k'),
    });
    for (const b of applied.benchmarks.filter((b) => b.distance !== '10k')) {
      const seconds = suggestedValues.get(b.distance);
      expect(b).toMatchObject({ source: 'generated', seconds, generatedSeconds: seconds });
    }
    expect(values['5k']!.seconds).toBeLessThan(valuesOf(current)['5k']!.seconds);
    expect((await me(session)).suggestion).toBeNull();
  });

  it('Dismiss hides the suggestion until different values appear', async () => {
    const session = await generatedRunner();
    const before = await profileOf(session);
    onStrava([fastFiveK()]);
    await checkedHoursAgo(session, 4);
    expect((await me(session)).suggestion).not.toBeNull();

    const res = await suggestion(session, 'dismiss');

    expect(res.statusCode).toBe(200);
    expect(res.json<FitnessProfile>().suggestion).toBeNull();
    expect(res.json<FitnessProfile>().benchmarks).toEqual(before.benchmarks);
    expect((await me(session)).suggestion).toBeNull();

    // The next check generates the same values again: still hidden.
    await checkedHoursAgo(session, 4);
    onStrava([run('Recovery', '2026-09-28T10:00:00Z', 6_000, 2_400)]);
    expect((await me(session)).suggestion).toBeNull();

    // A faster race changes the values: shown again.
    await checkedHoursAgo(session, 4);
    const faster = run('Road 5K', '2026-09-29T09:00:00Z', 5_000, 820);
    onStrava([faster]);
    expect((await me(session)).suggestion).toMatchObject({ source: { activityId: faster.id } });
  });

  it('is 409 without a pending suggestion, 400 for an unknown action, 401 signed out', async () => {
    const session = await generatedRunner();
    expect((await suggestion(session, 'apply')).statusCode).toBe(409);
    expect((await suggestion(session, 'dismiss')).statusCode).toBe(409);
    expect((await suggestion(session, 'ignore')).statusCode).toBe(400);
    expect(
      (await post(undefined, '/api/fitness-profile/suggestion', { action: 'apply' })).statusCode,
    ).toBe(401);
  });
});

describe('POST /api/activities/resync', () => {
  it('reconciles the whole list, records when, queues new runs and suggests', async () => {
    const session = await generatedRunner();
    const kept = await db.select().from(activities).where(eq(activities.runnerId, session.id));
    const [tenKRun, marathonRun] = kept.sort((a, b) => a.distance - b.distance);
    const race = run('Parkrun PB', '2026-09-26T13:00:00Z', 5_000, 840);
    // The marathon was deleted on Strava; a new 5K appeared.
    const listRequests = onStrava([{ ...tenK(), id: tenKRun!.id }, race]);

    const res = await post(session, '/api/activities/resync');

    expect(res.statusCode).toBe(200);
    // The whole list, not just runs after the latest stored one, despite the throttle.
    expect(listRequests).toHaveLength(1);
    expect(listRequests[0]!.searchParams.get('after')).toBeNull();
    const profile = res.json<FitnessProfile>();
    expect(Date.now() - Date.parse(profile.resyncedAt!)).toBeLessThan(HOUR);
    expect(profile.suggestion).toMatchObject({
      sources: [{ activityId: race.id }, expect.anything()],
    });
    const stored = await db.select().from(activities).where(eq(activities.runnerId, session.id));
    expect(stored.map((a) => a.id).sort()).toEqual([tenKRun!.id, race.id].sort());
    expect(stored.map((a) => a.id)).not.toContain(marathonRun!.id);
    expect(await newRunJobs(session.id)).toEqual([
      { target: race.id, priority: JOB_PRIORITY['new-run'] },
    ]);
    expect((await profileOf(session)).resyncedAt).toBe(profile.resyncedAt);
  });

  it('is 401 when signed out', async () => {
    expect((await post(undefined, '/api/activities/resync')).statusCode).toBe(401);
  });
});

describe('GET /api/me', () => {
  it('reports whether the Runner is onboarded', async () => {
    const session = await signIn();
    expect((await me(session)).onboarded).toBe(false);
    await db.update(runners).set({ onboardedAt: new Date() }).where(eq(runners.id, session.id));
    expect((await me(session)).onboarded).toBe(true);
  });
});
