import { eq } from 'drizzle-orm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { runners, stravaTokens } from '../db/schema.js';
import {
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
    });
    expect(fetch).toHaveBeenCalledOnce();
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
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([STRAVA_TOKEN_URL, STRAVA_ATHLETE_URL]);
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
    fetch.mockImplementation(async () => Response.json(athleteJson(athleteId)));

    const first = (await loginLive(app)).json<{ id: number }>();
    const second = (await loginLive(app)).json<{ id: number }>();

    expect(second.id).toBe(first.id);
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
