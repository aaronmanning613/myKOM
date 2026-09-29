import type { FitnessProfile, Me, Results } from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { activities, benchmarks, runners, segments, stravaTokens } from '../db/schema.js';
import { saveSearchArea } from '../search-area/store.js';
import { STRAVA_DEAUTHORIZE_URL } from '../strava/client.js';
import { testModeStravaFetch } from '../strava/test-fetch.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';
import { SESSION_COOKIE } from './session.js';

const database = useTestDatabase();
const { db } = database;
const runnerIds: number[] = [];

afterAll(async () => {
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
});

describe('POST /api/test/login', () => {
  it('is not registered unless test routes are on', async () => {
    const { app } = buildTestApp(database);
    const res = await app.inject({ method: 'POST', url: '/api/test/login' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('creates a Runner with tokens and signs them in', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/login',
      payload: { firstName: 'Eliud' },
    });

    expect(res.statusCode).toBe(200);
    const me = res.json<{ id: number; firstName: string; avatarUrl: null }>();
    runnerIds.push(me.id);
    expect(me).toEqual({
      id: expect.any(Number),
      firstName: 'Eliud',
      avatarUrl: null,
      onboarded: false,
      suggestion: null,
    });
    const [tokens] = await db.select().from(stravaTokens).where(eq(stravaTokens.runnerId, me.id));
    expect(tokens).toBeDefined();

    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: session.value },
    });
    expect(meRes.json()).toEqual(me);
    await app.close();
  });

  it('creates a new Runner each time', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const login = () => app.inject({ method: 'POST', url: '/api/test/login' });
    const first = (await login()).json<{ id: number; firstName: string }>();
    const second = (await login()).json<{ id: number }>();
    runnerIds.push(first.id, second.id);

    expect(first.firstName).toBe('Test');
    expect(second.id).not.toBe(first.id);
    await app.close();
  });
});

describe('POST /api/test/runs', () => {
  it('is not registered unless test routes are on', async () => {
    const { app } = buildTestApp(database);
    const res = await app.inject({ method: 'POST', url: '/api/test/runs', payload: { runs: [] } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('stores runs for the signed-in Runner and applies the generated profile', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const login = await app.inject({ method: 'POST', url: '/api/test/login' });
    const me = login.json<{ id: number }>();
    runnerIds.push(me.id);
    const session = login.cookies.find((c) => c.name === SESSION_COOKIE)!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/runs',
      cookies: { [SESSION_COOKIE]: session.value },
      payload: {
        runs: [
          { name: 'Marathon', distance: 42_195, movingTime: 8463, daysAgo: 300 },
          { name: '10K race', distance: 10_000, movingTime: 1839, daysAgo: 100 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const profile = res.json<FitnessProfile>();
    expect(profile.generation?.vdot).toBeCloseTo(71.1, 1);
    expect(profile.generation?.sources.map((s) => s.name).sort()).toEqual(['10K race', 'Marathon']);
    expect(profile.benchmarks).toHaveLength(13);
    expect(profile.benchmarks.every((b) => b.source === 'generated')).toBe(true);
    const stored = await db.select().from(activities).where(eq(activities.runnerId, me.id));
    expect(stored).toHaveLength(2);
    await app.close();
  });

  it('only suggests the generated profile when asked to', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const login = await app.inject({ method: 'POST', url: '/api/test/login' });
    runnerIds.push(login.json<{ id: number }>().id);
    const cookies = {
      [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value,
    };
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/test/runs', cookies, payload });

    await post({ runs: [{ name: 'Marathon', distance: 42_195, movingTime: 8463, daysAgo: 300 }] });
    const res = await post({
      runs: [{ name: 'Fast 10K', distance: 10_000, movingTime: 1800, daysAgo: 2 }],
      profile: 'suggest',
    });

    expect(res.statusCode).toBe(200);
    const profile = res.json<FitnessProfile>();
    expect(profile.suggestion?.sources.map((s) => s.name)).toContain('Fast 10K');
    expect(profile.generation?.sources.map((s) => s.name)).toEqual(['Marathon']);
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies });
    expect(me.json<Me>().suggestion?.source?.name).toBe('Fast 10K');
    await app.close();
  });

  it('needs a session', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const res = await app.inject({ method: 'POST', url: '/api/test/runs', payload: { runs: [] } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /api/test/segments', () => {
  const segment = {
    name: 'Canal Dash',
    lat: 45.42,
    lng: -75.69,
    distance: 1000,
    averageGrade: 0,
    athleteCount: 321,
    record: 185,
    pb: 190,
    recordAgeDays: 40,
  };

  it('is not registered unless test routes are on', async () => {
    const { app } = buildTestApp(database);
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/segments',
      payload: { segments: [] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('needs a session', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/segments',
      payload: { segments: [segment] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('stores Known Segments with details that the results rank', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const login = await app.inject({ method: 'POST', url: '/api/test/login' });
    const runnerId = login.json<{ id: number }>().id;
    runnerIds.push(runnerId);
    const cookies = {
      [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value,
    };
    await saveSearchArea(db, runnerId, { label: 'Ottawa', lat: 45.42, lng: -75.69, radiusKm: 1 });
    await db.insert(benchmarks).values([
      { runnerId, distance: '1k', seconds: 180, source: 'runner' },
      { runnerId, distance: '5k', seconds: 1020, source: 'runner' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/segments',
      cookies,
      payload: {
        segments: [segment, { ...segment, name: 'Never run', athleteCount: 3, pb: null }],
      },
    });
    expect(res.statusCode).toBe(204);

    const results = (await app.inject({ url: '/api/results', cookies })).json<Results>();
    const ids = [...results.targets, ...results.nearestMisses, ...results.suspicious].map(
      (row) => row.segmentId,
    );
    try {
      expect(results.targets.map((row) => [row.name, row.record, row.pb])).toEqual([
        ['Canal Dash', 185, 190],
        ['Never run', 185, null],
      ]);
      const age = Date.now() - Date.parse(results.targets[0]!.recordCheckedAt);
      expect(age / (24 * 60 * 60 * 1000)).toBeCloseTo(40, 1);
    } finally {
      await db.delete(runners).where(eq(runners.id, runnerId));
      if (ids.length) await db.delete(segments).where(inArray(segments.id, ids));
    }
    await app.close();
  });
});

describe('testModeStravaFetch', () => {
  it('accepts deauthorize and refuses everything else', async () => {
    expect((await testModeStravaFetch(STRAVA_DEAUTHORIZE_URL, { method: 'POST' })).ok).toBe(true);
    const res = await testModeStravaFetch('https://www.strava.com/oauth/token', { method: 'POST' });
    expect(res.status).toBe(503);
  });
});
