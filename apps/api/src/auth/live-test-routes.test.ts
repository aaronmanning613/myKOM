import { RUNNER_DAILY_READS, encodePolyline } from '@mykom/shared';
import { eq } from 'drizzle-orm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { activities, runners, stravaTokens } from '../db/schema.js';
import { recordRead } from '../jobs/budget.js';
import { createJobQueue } from '../jobs/queue.js';
import {
  STRAVA_API_URL,
  STRAVA_ATHLETE_URL,
  STRAVA_DEAUTHORIZE_URL,
  STRAVA_TOKEN_URL,
  createStravaClient,
} from '../strava/client.js';
import { DeauthorizeBlockedError, blockDeauthorize } from '../strava/live-mode.js';
import { createLiveTokenStore } from '../strava/live-token-store.js';
import {
  TEST_SESSION_SECRET,
  buildTestApp,
  randomAthleteId,
  testTokenCipher,
  useTestDatabase,
} from '../test/app.js';
import { LIVE_TOKEN_PLACEHOLDER } from './live-test-routes.js';
import { SESSION_COOKIE } from './session.js';

const database = useTestDatabase();
const { db } = database;
const athleteIds: number[] = [];

// Distinctive values, so a leak into a response or the database is easy to spot.
const FILE_ACCESS = 'file-access-SECRET-a1';
const FILE_REFRESH = 'file-refresh-SECRET-r1';
const NEW_ACCESS = 'new-access-SECRET-a2';
const NEW_REFRESH = 'new-refresh-SECRET-r2';
const SECRETS = [FILE_ACCESS, FILE_REFRESH, NEW_ACCESS, NEW_REFRESH];
const HOUR_S = 60 * 60;

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mykom-live-mode-'));
  path = join(dir, '.strava-live-token.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  for (const id of athleteIds) await db.delete(runners).where(eq(runners.stravaAthleteId, id));
});

async function writeTokenFile({ expiresInS = HOUR_S, scopes = ['read', 'activity:read_all'] }) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInS;
  await writeFile(
    path,
    JSON.stringify({ accessToken: FILE_ACCESS, refreshToken: FILE_REFRESH, expiresAt, scopes }),
  );
}

function athleteJson(id: number) {
  return {
    id,
    firstname: 'Faith',
    sex: 'F',
    profile: 'https://example.com/faith.jpg',
    summit: false,
  };
}

/** The app as server.ts builds it in live mode, with a mocked fetch behind the Strava client. */
function buildLiveApp() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  // The first sign-in's sync: no runs and no starred Segments unless a test says otherwise.
  fetch.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith(`${STRAVA_API_URL}/athlete/activities?`)) return Response.json([]);
    if (url.startsWith(`${STRAVA_API_URL}/segments/starred?`)) return Response.json([]);
    throw new Error(`Unexpected Strava call in the test: ${url}`);
  });
  const liveTokenStore = createLiveTokenStore({ path, env: {} });
  const strava = blockDeauthorize(
    createStravaClient({ clientId: '123', clientSecret: 'shh', tokenStore: liveTokenStore, fetch }),
  );
  const app = buildApp({
    database,
    strava,
    tokenCipher: testTokenCipher,
    sessionSecret: TEST_SESSION_SECRET,
    liveTokenStore,
    queue: createJobQueue(db, {}),
  });
  return { app, fetch };
}

async function loginLive(app: ReturnType<typeof buildLiveApp>['app']) {
  return app.inject({ method: 'POST', url: '/api/test/login-live' });
}

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text.includes(secret)).toBe(false);
}

describe('POST /api/test/login-live', () => {
  it('is not registered outside live mode, even with test routes on', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    const res = await loginLive(app);
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('signs in the real Runner from the live token, keeping the token out of the database', async () => {
    await writeTokenFile({});
    const athleteId = randomAthleteId();
    athleteIds.push(athleteId);
    const { app, fetch } = buildLiveApp();
    fetch.mockResolvedValueOnce(Response.json(athleteJson(athleteId)));

    const res = await loginLive(app);

    expect(res.statusCode).toBe(200);
    expectNoSecrets(res.body);
    const me = res.json<{ id: number }>();
    expect(me).toEqual({
      id: expect.any(Number),
      firstName: 'Faith',
      avatarUrl: 'https://example.com/faith.jpg',
      sex: 'F',
      recordGender: null,
      onboarded: false,
      suggestion: null,
    });
    // The athlete, then the first sync: the activity list and the starred Segments.
    expect(fetch.mock.calls.map(([url]) => String(url).split('?')[0])).toEqual([
      STRAVA_ATHLETE_URL,
      `${STRAVA_API_URL}/athlete/activities`,
      `${STRAVA_API_URL}/segments/starred`,
    ]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(STRAVA_ATHLETE_URL);
    expect(new Headers(init!.headers).get('authorization') === `Bearer ${FILE_ACCESS}`).toBe(true);

    const [runner] = await db.select().from(runners).where(eq(runners.id, me.id));
    expect(runner).toMatchObject({ stravaAthleteId: athleteId, firstName: 'Faith', sex: 'F' });
    const [tokens] = await db.select().from(stravaTokens).where(eq(stravaTokens.runnerId, me.id));
    expectNoSecrets(JSON.stringify(tokens));
    expect(testTokenCipher.decrypt(tokens!.accessToken)).toBe(LIVE_TOKEN_PLACEHOLDER);
    expect(testTokenCipher.decrypt(tokens!.refreshToken)).toBe(LIVE_TOKEN_PLACEHOLDER);
    expect(tokens!.grantedScopes).toEqual(['read', 'activity:read_all']);

    const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: session.value },
    });
    expect(meRes.json()).toEqual(me);
    await app.close();
  });

  it('refreshes an expiring live token and saves the rotated one to the token file', async () => {
    await writeTokenFile({ expiresInS: 60 });
    const athleteId = randomAthleteId();
    athleteIds.push(athleteId);
    const { app, fetch } = buildLiveApp();
    fetch
      .mockResolvedValueOnce(
        Response.json({
          access_token: NEW_ACCESS,
          refresh_token: NEW_REFRESH,
          expires_at: Math.floor(Date.now() / 1000) + 6 * HOUR_S,
        }),
      )
      .mockResolvedValueOnce(Response.json(athleteJson(athleteId)));

    const res = await loginLive(app);

    expect(res.statusCode).toBe(200);
    expect(fetch.mock.calls.map(([url]) => url).slice(0, 2)).toEqual([
      STRAVA_TOKEN_URL,
      STRAVA_ATHLETE_URL,
    ]);
    const file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(file.refreshToken === NEW_REFRESH).toBe(true);
    expect(file.scopes).toEqual(['read', 'activity:read_all']);
    await app.close();
  });

  it('updates the same Runner when they sign in again', async () => {
    await writeTokenFile({});
    const athleteId = randomAthleteId();
    athleteIds.push(athleteId);
    const { app, fetch } = buildLiveApp();
    // In call order: the athlete, the activity list and starred Segments, then the athlete again.
    const responses = [
      Response.json(athleteJson(athleteId)),
      Response.json([
        {
          id: athleteId,
          name: 'Morning Run',
          sport_type: 'Run',
          start_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          distance: 5000,
          moving_time: 1080,
          map: { summary_polyline: null },
        },
      ]),
      Response.json([]),
      Response.json(athleteJson(athleteId)),
    ];
    fetch.mockImplementation(async () => responses.shift()!);

    const first = (await loginLive(app)).json<{ id: number }>();
    const second = (await loginLive(app)).json<{ id: number }>();

    expect(second.id).toBe(first.id);
    // Only the first sign-in synced: it stored the run and applied the profile from it.
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      await db.select().from(activities).where(eq(activities.runnerId, first.id)),
    ).toHaveLength(1);
    const [runner] = await db.select().from(runners).where(eq(runners.id, first.id));
    expect(runner!.activitiesCheckedAt).not.toBeNull();
    await app.close();
  });

  it('replies 503 without calling Strava when there is no live token', async () => {
    const { app, fetch } = buildLiveApp();

    const res = await loginLive(app);

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'no_live_token' });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });

  it('replies 502 when Strava fails, without a token in the response', async () => {
    await writeTokenFile({});
    const { app, fetch } = buildLiveApp();
    fetch.mockResolvedValueOnce(new Response('{"message":"Authorization Error"}', { status: 401 }));

    const res = await loginLive(app);

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'live_sign_in_failed' });
    expectNoSecrets(res.body);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    await app.close();
  });
});

describe('POST /api/auth/disconnect in live mode', () => {
  it('fails with the blocked error, never calls deauthorize, and keeps everything', async () => {
    await writeTokenFile({});
    const athleteId = randomAthleteId();
    athleteIds.push(athleteId);
    const { app, fetch } = buildLiveApp();
    fetch.mockResolvedValueOnce(Response.json(athleteJson(athleteId)));
    const login = await loginLive(app);
    const me = login.json<{ id: number }>();
    const session = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    const fileBefore = await readFile(path, 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/disconnect',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: 'deauthorize_blocked',
      message: new DeauthorizeBlockedError().message,
    });
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(STRAVA_DEAUTHORIZE_URL);
    expect((await readFile(path, 'utf8')) === fileBefore).toBe(true);
    expect(await db.select().from(runners).where(eq(runners.id, me.id))).toHaveLength(1);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    await app.close();
  });
});

/** Signs in a fresh live Runner, returning their id and session cookie. */
async function signedInLiveRunner(
  app: ReturnType<typeof buildLiveApp>['app'],
  fetch: ReturnType<typeof buildLiveApp>['fetch'],
) {
  await writeTokenFile({});
  const athleteId = randomAthleteId();
  athleteIds.push(athleteId);
  fetch.mockResolvedValueOnce(Response.json(athleteJson(athleteId)));
  const login = await loginLive(app);
  const { id } = login.json<{ id: number }>();
  const session = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { runnerId: id, cookies: { [SESSION_COOKIE]: session } };
}

describe('the live smoke test helpers', () => {
  it('are not registered outside live mode', async () => {
    const { app } = buildTestApp(database, { testRoutes: true });
    for (const [method, url] of [
      ['GET', '/api/test/live-reads'],
      ['POST', '/api/test/live-read-allowance'],
      ['GET', '/api/test/live-run-start'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(404);
    }
    await app.close();
  });

  it('need a signed-in Runner', async () => {
    const { app } = buildLiveApp();
    expect((await app.inject({ method: 'GET', url: '/api/test/live-reads' })).statusCode).toBe(401);
    const allowance = await app.inject({
      method: 'POST',
      url: '/api/test/live-read-allowance',
      payload: { reads: 30 },
    });
    expect(allowance.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/test/live-run-start' })).statusCode).toBe(
      401,
    );
    await app.close();
  });

  it('report the Runner’s reads today, and an allowance raises the counter but never lowers it', async () => {
    const { app, fetch } = buildLiveApp();
    const { runnerId, cookies } = await signedInLiveRunner(app, fetch);
    const reads = () => app.inject({ method: 'GET', url: '/api/test/live-reads', cookies });
    const allow = (n: number) =>
      app.inject({
        method: 'POST',
        url: '/api/test/live-read-allowance',
        cookies,
        payload: { reads: n },
      });

    expect((await reads()).json()).toEqual({ readsToday: 0 });
    await recordRead(db, {
      runnerId,
      rateLimits: { overall: null, read: null },
      rateLimited: false,
      at: new Date(),
    });
    expect((await reads()).json()).toEqual({ readsToday: 1 });

    expect((await allow(30)).json()).toEqual({ readsToday: RUNNER_DAILY_READS - 30 });
    expect((await allow(100)).json()).toEqual({ readsToday: RUNNER_DAILY_READS - 30 });
    expect((await reads()).json()).toEqual({ readsToday: RUNNER_DAILY_READS - 30 });
    expect((await allow(-1)).statusCode).toBe(400);
    await app.close();
  });

  it('give the start of the Runner’s latest run with a route', async () => {
    const { app, fetch } = buildLiveApp();
    const { runnerId, cookies } = await signedInLiveRunner(app, fetch);
    const runStart = () => app.inject({ method: 'GET', url: '/api/test/live-run-start', cookies });
    expect((await runStart()).statusCode).toBe(404);

    const run = (id: number, daysAgo: number, polyline: string | null) => ({
      id,
      runnerId,
      name: 'Run',
      sportType: 'Run',
      startDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      distance: 5000,
      movingTime: 1500,
      summaryPolyline: polyline,
    });
    const base = randomAthleteId();
    await db.insert(activities).values([
      run(
        base,
        3,
        encodePolyline([
          { lat: 51.45, lng: -2.59 },
          { lat: 51.46, lng: -2.6 },
        ]),
      ),
      run(
        base + 1,
        2,
        encodePolyline([
          { lat: 53.8, lng: -1.55 },
          { lat: 53.81, lng: -1.56 },
        ]),
      ),
      // Newer, but a treadmill run: no route.
      run(base + 2, 1, null),
      run(base + 3, 0, ''),
    ]);

    expect((await runStart()).json()).toEqual({ lat: 53.8, lng: -1.55 });
    await app.close();
  });
});

describe('blockDeauthorize', () => {
  it('throws the blocked error without calling Strava, and leaves the other calls alone', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createStravaClient({
      clientId: '123',
      clientSecret: 'shh',
      tokenStore: { load: async () => undefined, save: async () => {} },
      fetch,
    });
    const blocked = blockDeauthorize(client);

    await expect(blocked.deauthorize('token')).rejects.toBeInstanceOf(DeauthorizeBlockedError);
    expect(fetch).not.toHaveBeenCalled();
    expect(blocked.getAthlete).toBe(client.getAthlete);
  });
});
