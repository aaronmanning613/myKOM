// The generated Fitness Profile through the API: regenerate, pins, "use generated",
// update-all, reset, suggestions in GET, and the KOM/QOM preference.
import { benchmarksFromVdot, type FitnessProfile } from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { activities, fitnessProfiles, runners } from '../db/schema.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';

const database = useTestDatabase();
const { db } = database;
const { app, fetch } = buildTestApp(database, { testRoutes: true });
const runnerIds: number[] = [];

afterAll(async () => {
  await app.close();
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
});

/** Signs in a new Runner and returns their id and session cookie. */
async function signIn() {
  const res = await app.inject({ method: 'POST', url: '/api/test/login' });
  const { id } = res.json<{ id: number }>();
  runnerIds.push(id);
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { id, cookies: { [SESSION_COOKIE]: session } };
}

type Session = Awaited<ReturnType<typeof signIn>>;

const getProfile = (session: Session) =>
  app.inject({ method: 'GET', url: '/api/fitness-profile', cookies: session.cookies });

const putProfile = (session: Session, payload: object) =>
  app.inject({ method: 'PUT', url: '/api/fitness-profile', cookies: session.cookies, payload });

const post = (session: Session | undefined, url: string, payload?: object) =>
  app.inject({ method: 'POST', url, cookies: session?.cookies, payload });

const regenerate = (session: Session) => post(session, '/api/fitness-profile/regenerate');

const summary = (profile: FitnessProfile) =>
  profile.benchmarks.map(({ distance, seconds, source }) => ({ distance, seconds, source }));

const byDistance = (profile: FitnessProfile) =>
  Object.fromEntries(profile.benchmarks.map((b) => [b.distance, b]));

// Strava activity ids of this file's own, so they can't clash with other files' rows.
let nextActivityId = 800_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1_000;

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

// The test account: marathon 2:21:03 and 10K 30:39 give VDOT 71.1 (5K 14:43, 10K 30:36,
// marathon 2:21:16). The easy 8K scores far lower, so it doesn't count.
const marathon = () => run('Toronto Waterfront', '2026-05-03T13:00:00Z', 42_195, 8_463);
const tenK = () => run('Canada Day 10K', '2026-07-01T12:00:00Z', 10_000, 1_839);
const easy = () => run('Easy jog', '2026-09-20T10:00:00Z', 8_000, 3_000);

/** Strava's activity list returns `runs` on page 1; returns the list URLs asked for. */
function onStrava(runs: object[]) {
  const listRequests: URL[] = [];
  fetch.mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/api/v3/athlete/activities') {
      listRequests.push(url);
      return Response.json(url.searchParams.get('page') === '1' ? runs : []);
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  });
  return listRequests;
}

/** A Runner whose applied generation came from the test account's marathon and 10K. */
async function generatedRunner() {
  const session = await signIn();
  onStrava([easy(), tenK(), marathon()]);
  const profile = (await regenerate(session)).json<FitnessProfile>();
  return { session, profile };
}

const withinOne = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);

describe('POST /api/fitness-profile/regenerate', () => {
  it('is 401 when signed out', async () => {
    expect((await post(undefined, '/api/fitness-profile/regenerate')).statusCode).toBe(401);
  });

  it('reads the new runs and applies the generated profile to all 13 Benchmarks', async () => {
    const session = await signIn();
    const [t, m] = [tenK(), marathon()];
    const listRequests = onStrava([easy(), t, m]);

    const res = await regenerate(session);

    expect(res.statusCode).toBe(200);
    expect(listRequests).toHaveLength(1);
    const profile = res.json<FitnessProfile>();
    expect(profile.benchmarks).toHaveLength(13);
    for (const b of profile.benchmarks) {
      expect(b).toMatchObject({ source: 'generated', generatedSeconds: b.seconds, soft: false });
    }
    const values = byDistance(profile);
    withinOne(values['5k']!.seconds, 883);
    withinOne(values['10k']!.seconds, 1836);
    withinOne(values.marathon!.seconds, 8476);
    expect(profile.generation!.vdot).toBeCloseTo(71.1, 1);
    // Best first: the marathon scores slightly higher.
    expect(profile.generation!.sources).toEqual([
      expect.objectContaining({ activityId: m.id, benchmark: 'marathon' }),
      {
        activityId: t.id,
        name: 'Canada Day 10K',
        startDate: '2026-07-01T12:00:00.000Z',
        benchmark: '10k',
        distance: 10_000,
        movingTime: 1_839,
      },
    ]);
    expect(profile.suggestion).toBeNull();
    expect((await getProfile(session)).json()).toEqual(profile);
  });

  it('keeps pinned Benchmarks, updating only their generated value', async () => {
    const { session, profile } = await generatedRunner();
    const edited = profile.benchmarks.map(({ distance, seconds }) => ({
      distance,
      seconds: distance === '5k' ? 900 : seconds,
    }));
    await putProfile(session, { benchmarks: edited });
    // A faster 10K since. Only runs after the latest stored one are asked for.
    const listRequests = onStrava([run('Fast 10K', '2026-09-27T12:00:00Z', 10_000, 1_780)]);

    const after = (await regenerate(session)).json<FitnessProfile>();

    expect(listRequests[0]!.searchParams.get('after')).toBe(
      String(Date.parse('2026-09-20T10:00:00Z') / 1000),
    );
    const values = byDistance(after);
    expect(values['5k']).toMatchObject({ seconds: 900, source: 'runner' });
    expect(values['5k']!.generatedSeconds).toBeLessThan(byDistance(profile)['5k']!.seconds);
    expect(values['10k']).toMatchObject({ source: 'generated' });
    expect(values['10k']!.seconds).toBeLessThan(byDistance(profile)['10k']!.seconds);
    expect(after.generation!.sources[0]!.name).toBe('Fast 10K');
  });

  it('with no qualifying runs, leaves only the pinned Benchmarks', async () => {
    const session = await signIn();
    await putProfile(session, { benchmarks: [{ distance: '5k', seconds: 1200 }] });
    // A 5K from outside the 3-year window.
    await db.insert(activities).values({
      id: ++nextActivityId,
      runnerId: session.id,
      name: 'Old 5K',
      sportType: 'Run',
      startDate: new Date('2020-01-01T00:00:00Z'),
      distance: 5_000,
      movingTime: 1_000,
    });
    onStrava([]);

    const profile = (await regenerate(session)).json<FitnessProfile>();

    expect(profile.generation).toBeNull();
    expect(summary(profile)).toEqual([{ distance: '5k', seconds: 1200, source: 'runner' }]);
  });

  it('blanks an earlier generation once no run qualifies', async () => {
    const { session, profile } = await generatedRunner();
    await putProfile(session, {
      benchmarks: profile.benchmarks.map(({ distance, seconds }) => ({
        distance,
        seconds: distance === '1k' ? 200 : seconds,
      })),
    });
    // The runs are gone (as after a resync that found them deleted on Strava).
    await db.delete(activities).where(eq(activities.runnerId, session.id));
    onStrava([]);

    const blanked = (await regenerate(session)).json<FitnessProfile>();

    expect(blanked.generation).toBeNull();
    expect(blanked.benchmarks).toEqual([
      expect.objectContaining({ distance: '1k', seconds: 200, generatedSeconds: null }),
    ]);
  });

  it('applies directly, clearing a pending suggestion', async () => {
    const { session } = await generatedRunner();
    await db
      .update(fitnessProfiles)
      .set({ suggestedVdot: 60, suggestedSourceActivityIds: [], suggestedAt: new Date() })
      .where(eq(fitnessProfiles.runnerId, session.id));
    expect((await getProfile(session)).json<FitnessProfile>().suggestion).not.toBeNull();
    onStrava([]);

    expect((await regenerate(session)).json<FitnessProfile>().suggestion).toBeNull();
  });

  it('replies 502 and changes nothing when Strava fails', async () => {
    const { session, profile } = await generatedRunner();
    fetch.mockImplementation(async () => Response.json({ message: 'down' }, { status: 503 }));

    expect((await regenerate(session)).statusCode).toBe(502);
    expect((await getProfile(session)).json()).toEqual(profile);
  });
});

describe('GET /api/fitness-profile', () => {
  it('flags soft Benchmarks', async () => {
    const session = await signIn();
    const res = await putProfile(session, {
      benchmarks: [
        { distance: '5k', seconds: 1500 },
        { distance: '10k', seconds: 2400 },
      ],
    });
    expect(res.json<FitnessProfile>().benchmarks.map((b) => [b.distance, b.soft])).toEqual([
      ['5k', true],
      ['10k', false],
    ]);
  });

  it('returns a pending suggestion with its runs and all 13 suggested values', async () => {
    const { session, profile } = await generatedRunner();
    const fast = profile.generation!.sources[0]!;
    const suggestedAt = new Date('2026-09-28T09:00:00Z');
    await db
      .update(fitnessProfiles)
      .set({ suggestedVdot: 72.5, suggestedSourceActivityIds: [fast.activityId], suggestedAt })
      .where(eq(fitnessProfiles.runnerId, session.id));

    const { suggestion, benchmarks } = (await getProfile(session)).json<FitnessProfile>();

    expect(suggestion).toEqual({
      vdot: 72.5,
      sources: [fast],
      generatedAt: suggestedAt.toISOString(),
      benchmarks: benchmarksFromVdot(72.5),
    });
    // Nothing changes until it's applied.
    expect(benchmarks).toEqual(profile.benchmarks);
  });

  it('leaves out a source run deleted since', async () => {
    const { session, profile } = await generatedRunner();
    const [first, second] = profile.generation!.sources;
    await db.delete(activities).where(eq(activities.id, first!.activityId));

    expect((await getProfile(session)).json<FitnessProfile>().generation!.sources).toEqual([
      second,
    ]);
  });
});

describe('PUT /api/fitness-profile with a generated profile', () => {
  it('pins an edited row, keeping its generated value, and "use generated" unpins it', async () => {
    const { session, profile } = await generatedRunner();
    const generated5k = byDistance(profile)['5k']!.seconds;
    const rows = profile.benchmarks.map(({ distance, seconds }) => ({ distance, seconds }));

    const pinned = await putProfile(session, {
      benchmarks: rows.map((b) => (b.distance === '5k' ? { ...b, seconds: 900 } : b)),
    });

    expect(byDistance(pinned.json())['5k']).toMatchObject({
      seconds: 900,
      source: 'runner',
      generatedSeconds: generated5k,
    });
    // Rows sent back unchanged stay generated.
    expect(byDistance(pinned.json())['10k']).toMatchObject({ source: 'generated' });

    const unpinned = await putProfile(session, {
      benchmarks: rows.map((b) =>
        b.distance === '5k' ? { distance: '5k', useGenerated: true } : b,
      ),
    });

    expect(unpinned.statusCode).toBe(200);
    expect(byDistance(unpinned.json())['5k']).toMatchObject({
      seconds: generated5k,
      source: 'generated',
      generatedSeconds: generated5k,
    });
  });

  it('gives a newly entered row its generated value', async () => {
    const { session, profile } = await generatedRunner();
    await putProfile(session, { benchmarks: [] });
    await putProfile(session, { benchmarks: [{ distance: '5k', seconds: 900 }] });

    expect(byDistance((await getProfile(session)).json())['5k']).toMatchObject({
      seconds: 900,
      source: 'runner',
      generatedSeconds: byDistance(profile)['5k']!.seconds,
    });
  });

  it.each([
    ['"use generated" without a generated profile', { distance: '5k', useGenerated: true }],
    ['a time and "use generated" together', { distance: '5k', seconds: 900, useGenerated: true }],
    ['"use generated" set to false', { distance: '5k', useGenerated: false }],
  ])('rejects %s with 400', async (_name, row) => {
    const session = await signIn();
    await putProfile(session, { benchmarks: [{ distance: '1k', seconds: 200 }] });

    expect((await putProfile(session, { benchmarks: [row] })).statusCode).toBe(400);
    expect(summary((await getProfile(session)).json())).toEqual([
      { distance: '1k', seconds: 200, source: 'runner' },
    ]);
  });
});

describe('POST /api/fitness-profile/update-all', () => {
  const updateAll = (session: Session | undefined, payload: object) =>
    post(session, '/api/fitness-profile/update-all', payload);

  it('is 401 when signed out', async () => {
    expect((await updateAll(undefined, { distance: '5k', seconds: 960 })).statusCode).toBe(401);
  });

  it('pins all 13 from one time, overwriting other pins and keeping generated values', async () => {
    const { session, profile } = await generatedRunner();
    await putProfile(session, { benchmarks: [{ distance: '1k', seconds: 200 }] });

    const res = await updateAll(session, { distance: '5k', seconds: 960 });

    expect(res.statusCode).toBe(200);
    const after = res.json<FitnessProfile>();
    expect(after.benchmarks).toHaveLength(13);
    const generated = byDistance(profile);
    for (const b of after.benchmarks) {
      expect(b).toMatchObject({
        source: 'runner',
        generatedSeconds: generated[b.distance]!.seconds,
      });
    }
    const values = byDistance(after);
    expect(values['5k']!.seconds).toBe(960);
    // A 16:00 5K gives 10K 33:13, half 1:13:19, marathon 2:33:26.
    withinOne(values['10k']!.seconds, 1993);
    withinOne(values['half-marathon']!.seconds, 4399);
    withinOne(values.marathon!.seconds, 9206);
    expect(values['1k']!.seconds).not.toBe(200);
  });

  it('works without a generated profile', async () => {
    const session = await signIn();
    const res = await updateAll(session, { distance: '10k', seconds: 2400 });
    const after = res.json<FitnessProfile>();
    expect(after.benchmarks).toHaveLength(13);
    expect(after.benchmarks.every((b) => b.generatedSeconds === null)).toBe(true);
  });

  it.each([
    ['an unknown distance', { distance: '2-mile', seconds: 700 }],
    ['zero seconds', { distance: '5k', seconds: 0 }],
    ['no time', { distance: '5k' }],
  ])('rejects %s with 400', async (_name, payload) => {
    const session = await signIn();
    expect((await updateAll(session, payload)).statusCode).toBe(400);
    expect((await getProfile(session)).json<FitnessProfile>().benchmarks).toEqual([]);
  });
});

describe('POST /api/fitness-profile/reset', () => {
  const reset = (session?: Session) => post(session, '/api/fitness-profile/reset');

  it('is 401 when signed out', async () => {
    expect((await reset()).statusCode).toBe(401);
  });

  it('unpins everything back to the generated values', async () => {
    const { session, profile } = await generatedRunner();
    await post(session, '/api/fitness-profile/update-all', { distance: '5k', seconds: 960 });
    // Distances cleared since come back too.
    await putProfile(session, { benchmarks: [{ distance: '5k', seconds: 960 }] });

    const res = await reset(session);

    expect(res.statusCode).toBe(200);
    expect(summary(res.json())).toEqual(summary(profile));
  });

  it('is 409 without a generated profile, and changes nothing', async () => {
    const session = await signIn();
    await putProfile(session, { benchmarks: [{ distance: '5k', seconds: 960 }] });

    expect((await reset(session)).statusCode).toBe(409);
    expect(summary((await getProfile(session)).json())).toEqual([
      { distance: '5k', seconds: 960, source: 'runner' },
    ]);
  });
});

describe('PUT /api/preferences', () => {
  const putPreferences = (session: Session | undefined, payload: object) =>
    app.inject({ method: 'PUT', url: '/api/preferences', cookies: session?.cookies, payload });

  const recordGender = async (id: number) =>
    (await db.select().from(runners).where(eq(runners.id, id)))[0]!.recordGender;

  it('is 401 when signed out', async () => {
    expect((await putPreferences(undefined, { recordGender: 'QOM' })).statusCode).toBe(401);
  });

  it('sets KOM or QOM', async () => {
    const session = await signIn();
    const res = await putPreferences(session, { recordGender: 'QOM' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recordGender: 'QOM' });
    expect(await recordGender(session.id)).toBe('QOM');

    await putPreferences(session, { recordGender: 'KOM' });
    expect(await recordGender(session.id)).toBe('KOM');
  });

  it.each([[{}], [{ recordGender: 'CR' }], [{ recordGender: null }]])(
    'rejects %j with 400',
    async (payload) => {
      const session = await signIn();
      expect((await putPreferences(session, payload)).statusCode).toBe(400);
      expect(await recordGender(session.id)).toBeNull();
    },
  );
});
