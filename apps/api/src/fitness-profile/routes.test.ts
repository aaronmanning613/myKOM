import { BENCHMARK_DISTANCES, type BenchmarkDistanceId, type FitnessProfile } from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { benchmarks, runners } from '../db/schema.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';

const database = useTestDatabase();
const { db } = database;
const { app } = buildTestApp(database, { testRoutes: true });
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

const getProfile = (session?: Session) =>
  app.inject({ method: 'GET', url: '/api/fitness-profile', cookies: session?.cookies });

const putProfile = (session: Session | undefined, payload: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/api/fitness-profile',
    cookies: session?.cookies,
    payload: payload as object,
  });

const summary = (profile: FitnessProfile) =>
  profile.benchmarks.map(({ distance, seconds, source }) => ({ distance, seconds, source }));

describe('GET /api/fitness-profile', () => {
  it('is 401 when signed out', async () => {
    const res = await getProfile();
    expect(res.statusCode).toBe(401);
  });

  it('is empty for a new Runner', async () => {
    const res = await getProfile(await signIn());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      benchmarks: [],
      generation: null,
      suggestion: null,
      resyncedAt: null,
    });
  });

  it('is 401 and clears the session once the Runner is deleted', async () => {
    const session = await signIn();
    await db.delete(runners).where(eq(runners.id, session.id));
    const res = await getProfile(session);
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
  });

  it('lists Benchmarks in distance order and skips distances no longer offered', async () => {
    const session = await signIn();
    await db.insert(benchmarks).values([
      { runnerId: session.id, distance: '10k', seconds: 2400, source: 'runner' },
      {
        runnerId: session.id,
        // A distance since removed from BENCHMARK_DISTANCES.
        distance: 'half-mile' as BenchmarkDistanceId,
        seconds: 10800,
        source: 'runner',
      },
      { runnerId: session.id, distance: '400m', seconds: 70, source: 'generated' },
    ]);
    const profile = (await getProfile(session)).json<FitnessProfile>();
    expect(summary(profile)).toEqual([
      { distance: '400m', seconds: 70, source: 'generated' },
      { distance: '10k', seconds: 2400, source: 'runner' },
    ]);
    expect(new Date(profile.benchmarks[0]!.updatedAt).getTime()).not.toBeNaN();
  });
});

describe('PUT /api/fitness-profile', () => {
  it('is 401 when signed out', async () => {
    const res = await putProfile(undefined, { benchmarks: [] });
    expect(res.statusCode).toBe(401);
  });

  it('saves Benchmarks as source runner and returns the profile', async () => {
    const session = await signIn();
    const res = await putProfile(session, {
      benchmarks: [
        { distance: '5k', seconds: 1200 },
        { distance: '1-mile', seconds: 330 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const expected = [
      { distance: '1-mile', seconds: 330, source: 'runner' },
      { distance: '5k', seconds: 1200, source: 'runner' },
    ];
    expect(summary(res.json())).toEqual(expected);
    expect(summary((await getProfile(session)).json())).toEqual(expected);
  });

  it('accepts a Benchmark at every one of the 13 distances', async () => {
    const session = await signIn();
    const all = BENCHMARK_DISTANCES.map((d, i) => ({ distance: d.id, seconds: 60 + i * 600 }));
    expect(all).toHaveLength(13);
    const res = await putProfile(session, { benchmarks: all });
    expect(res.statusCode).toBe(200);
    expect(summary(res.json())).toEqual(all.map((b) => ({ ...b, source: 'runner' })));
  });

  it('replaces the whole profile: changes times and clears distances left out', async () => {
    const session = await signIn();
    await putProfile(session, {
      benchmarks: [
        { distance: '5k', seconds: 1200 },
        { distance: '10k', seconds: 2500 },
      ],
    });
    const res = await putProfile(session, { benchmarks: [{ distance: '5k', seconds: 1180 }] });
    expect(summary(res.json())).toEqual([{ distance: '5k', seconds: 1180, source: 'runner' }]);

    const cleared = await putProfile(session, { benchmarks: [] });
    expect(cleared.json()).toEqual({
      benchmarks: [],
      generation: null,
      suggestion: null,
      resyncedAt: null,
    });
    const rows = await db.select().from(benchmarks).where(eq(benchmarks.runnerId, session.id));
    expect(rows).toEqual([]);
  });

  it('keeps the source and updated time of an unchanged Benchmark', async () => {
    const session = await signIn();
    const imported = new Date('2026-01-01T00:00:00Z');
    await db.insert(benchmarks).values([
      {
        runnerId: session.id,
        distance: '1k',
        seconds: 190,
        source: 'generated',
        updatedAt: imported,
      },
      {
        runnerId: session.id,
        distance: '5k',
        seconds: 1200,
        source: 'generated',
        updatedAt: imported,
      },
    ]);
    const res = await putProfile(session, {
      benchmarks: [
        { distance: '1k', seconds: 190 },
        { distance: '5k', seconds: 1150 },
      ],
    });
    const [oneK, fiveK] = res.json<FitnessProfile>().benchmarks;
    expect(oneK).toEqual({
      distance: '1k',
      seconds: 190,
      source: 'generated',
      generatedSeconds: null,
      soft: false,
      updatedAt: imported.toISOString(),
    });
    expect(fiveK).toMatchObject({ distance: '5k', seconds: 1150, source: 'runner' });
    expect(fiveK!.updatedAt).not.toBe(imported.toISOString());
  });

  it('ignores a source sent by the Runner', async () => {
    const session = await signIn();
    const res = await putProfile(session, {
      benchmarks: [{ distance: '5k', seconds: 1200, source: 'generated' }],
    });
    expect(summary(res.json())).toEqual([{ distance: '5k', seconds: 1200, source: 'runner' }]);
  });

  it.each([
    ['no benchmarks field', {}],
    ['a dropped distance', { benchmarks: [{ distance: '2-mile', seconds: 700 }] }],
    ['zero seconds', { benchmarks: [{ distance: '5k', seconds: 0 }] }],
    ['negative seconds', { benchmarks: [{ distance: '5k', seconds: -5 }] }],
    ['fractional seconds', { benchmarks: [{ distance: '5k', seconds: 1200.5 }] }],
    ['more than a day', { benchmarks: [{ distance: '5k', seconds: 24 * 60 * 60 + 1 }] }],
    ['a missing time', { benchmarks: [{ distance: '5k' }] }],
    [
      'a repeated distance',
      {
        benchmarks: [
          { distance: '5k', seconds: 1200 },
          { distance: '5k', seconds: 1100 },
        ],
      },
    ],
  ])('rejects %s with 400 and saves nothing', async (_name, payload) => {
    const session = await signIn();
    await putProfile(session, { benchmarks: [{ distance: '1k', seconds: 200 }] });
    const res = await putProfile(session, payload);
    expect(res.statusCode).toBe(400);
    expect(summary((await getProfile(session)).json())).toEqual([
      { distance: '1k', seconds: 200, source: 'runner' },
    ]);
  });
});

describe("one Runner and another's Benchmarks", () => {
  let alice: Session;
  let bob: Session;

  beforeAll(async () => {
    alice = await signIn();
    bob = await signIn();
    await putProfile(alice, { benchmarks: [{ distance: '5k', seconds: 1100 }] });
  });

  it("can't read them", async () => {
    expect((await getProfile(bob)).json<FitnessProfile>().benchmarks).toEqual([]);
  });

  it("can't change or clear them", async () => {
    await putProfile(bob, { benchmarks: [{ distance: '5k', seconds: 900 }] });
    await putProfile(bob, { benchmarks: [] });
    expect(summary((await getProfile(alice)).json())).toEqual([
      { distance: '5k', seconds: 1100, source: 'runner' },
    ]);
  });

  it('go when the Runner is deleted', async () => {
    await db.delete(runners).where(eq(runners.id, alice.id));
    const rows = await db.select().from(benchmarks).where(eq(benchmarks.runnerId, alice.id));
    expect(rows).toEqual([]);
  });
});
