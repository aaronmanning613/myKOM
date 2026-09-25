import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { runners, stravaTokens } from '../db/schema.js';
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
    expect(me).toEqual({ id: expect.any(Number), firstName: 'Eliud', avatarUrl: null });
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

describe('testModeStravaFetch', () => {
  it('accepts deauthorize and refuses everything else', async () => {
    expect((await testModeStravaFetch(STRAVA_DEAUTHORIZE_URL, { method: 'POST' })).ok).toBe(true);
    const res = await testModeStravaFetch('https://www.strava.com/oauth/token', { method: 'POST' });
    expect(res.status).toBe(503);
  });
});
