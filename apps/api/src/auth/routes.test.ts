import { eq, getTableName, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest';
import {
  activities,
  benchmarks,
  crawls,
  fitnessProfiles,
  mappedAreas,
  runnerSegments,
  runners,
  searchAreas,
  segmentEfforts,
  segments,
  stravaJobs,
  stravaReadUsage,
  stravaTokens,
} from '../db/schema.js';
import {
  STRAVA_AUTHORIZE_URL,
  STRAVA_DEAUTHORIZE_URL,
  StravaRevokedError,
  type StravaClient,
} from '../strava/client.js';
import { buildTestApp, randomAthleteId, testTokenCipher, useTestDatabase } from '../test/app.js';
import { STATE_COOKIE } from './routes.js';
import { SESSION_COOKIE, sessionRunnerId } from './session.js';

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

function tokenResponse(athleteId: number, overrides: Record<string, unknown> = {}) {
  return Response.json({
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_at: 2_000_000_000,
    athlete: {
      id: athleteId,
      firstname: 'Paula',
      sex: 'F',
      profile: 'https://example.com/paula.jpg',
      summit: true,
    },
    ...overrides,
  });
}

/** Starts sign-in like a browser would, returning the state and its signed cookie. */
async function startSignIn() {
  const res = await app.inject({
    method: 'GET',
    url: '/api/auth/strava',
    headers: { host: 'localhost:5173' },
  });
  const cookie = res.cookies.find((c) => c.name === STATE_COOKIE)!;
  const state = new URL(res.headers.location!).searchParams.get('state')!;
  return { res, cookie, state };
}

async function callback(query: Record<string, string>, stateCookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/auth/strava/callback?${new URLSearchParams(query)}`,
    cookies: stateCookie ? { [STATE_COOKIE]: stateCookie } : {},
  });
}

/** Signs a new Runner in through the callback and returns their session cookie value. */
async function signIn(
  athleteId: number,
  scope = 'read,activity:read_all',
  tokens: Record<string, unknown> = {},
) {
  athleteIds.push(athleteId);
  fetch.mockResolvedValueOnce(tokenResponse(athleteId, tokens));
  const { cookie, state } = await startSignIn();
  const res = await callback({ code: 'the-code', state, scope }, cookie.value);
  return { res, session: res.cookies.find((c) => c.name === SESSION_COOKIE) };
}

/** Signs a Runner in and returns their id and session cookie value. */
async function signInRunner(tokens: Record<string, unknown> = {}) {
  const athleteId = randomAthleteId();
  const { session } = await signIn(athleteId, undefined, tokens);
  const [runner] = await db.select().from(runners).where(eq(runners.stravaAthleteId, athleteId));
  return { runnerId: runner!.id, session: session!.value };
}

/** Every per-Runner table, by the column that links it to the Runner. */
const perRunnerTables = {
  stravaTokens: [stravaTokens, stravaTokens.runnerId],
  benchmarks: [benchmarks, benchmarks.runnerId],
  searchAreas: [searchAreas, searchAreas.runnerId],
  fitnessProfiles: [fitnessProfiles, fitnessProfiles.runnerId],
  activities: [activities, activities.runnerId],
  runnerSegments: [runnerSegments, runnerSegments.runnerId],
  segmentEfforts: [segmentEfforts, segmentEfforts.runnerId],
  mappedAreas: [mappedAreas, mappedAreas.runnerId],
  crawls: [crawls, crawls.runnerId],
  stravaJobs: [stravaJobs, stravaJobs.runnerId],
  stravaReadUsage: [stravaReadUsage, stravaReadUsage.runnerId],
} as const;
const perRunnerTableNames = Object.values(perRunnerTables).map(([table]) => getTableName(table));

/** The Runner's row count in `runners` and every per-Runner table. */
async function perRunnerCounts(runnerId: number) {
  const counts: Record<string, number> = {
    runners: await db.$count(runners, eq(runners.id, runnerId)),
  };
  for (const [name, [table, column]] of Object.entries(perRunnerTables)) {
    counts[name] = await db.$count(table, eq(column, runnerId));
  }
  return counts;
}

/** Gives the Runner a row in every per-Runner table, linked to a shared Segment. */
async function seedEverything(runnerId: number, segmentId: number) {
  const activityId = segmentId + 1;
  await db.insert(benchmarks).values({ runnerId, distance: '5k', seconds: 1200, source: 'runner' });
  await db
    .insert(searchAreas)
    .values({ runnerId, label: 'Ottawa', lat: 45.4, lng: -75.7, radiusKm: 5 });
  await db.insert(fitnessProfiles).values({ runnerId, vdot: 60, sourceActivityIds: [activityId] });
  await db.insert(activities).values({
    id: activityId,
    runnerId,
    name: 'Morning Run',
    sportType: 'Run',
    startDate: new Date('2026-09-01T10:00:00Z'),
    distance: 5000,
    movingTime: 1300,
  });
  await db.insert(segments).values({
    id: segmentId,
    name: 'Canal sprint',
    distance: 400,
    startLat: 45.4,
    startLng: -75.7,
  });
  await db.insert(runnerSegments).values({ runnerId, segmentId, viaRun: true, effortCount: 1 });
  await db.insert(segmentEfforts).values({
    id: BigInt(segmentId + 2),
    runnerId,
    activityId,
    segmentId,
    elapsedTime: 80,
    startDate: new Date('2026-09-01T10:05:00Z'),
  });
  const [area] = await db
    .insert(mappedAreas)
    .values({ runnerId, label: 'Gatineau', lat: 45.5, lng: -75.9, radiusKm: 25 })
    .returning();
  const [crawl] = await db
    .insert(crawls)
    .values({ runnerId, mappedAreaId: area!.id, lat: 45.5, lng: -75.9, radiusKm: 25 })
    .returning();
  await db.insert(stravaJobs).values({
    kind: 'segment-detail',
    target: segmentId,
    runnerId,
    crawlId: crawl!.id,
    priority: 1,
  });
  await db.insert(stravaReadUsage).values({
    runnerId,
    window: 'day',
    windowStart: new Date('2026-09-29T00:00:00Z'),
    reads: 3,
  });
}

describe('GET /api/auth/strava', () => {
  it('redirects to Strava with a state matching a signed, short-lived cookie', async () => {
    const { res, cookie, state } = await startSignIn();

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location!);
    expect(`${location.origin}${location.pathname}`).toBe(STRAVA_AUTHORIZE_URL);
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/auth/strava/callback',
    );
    expect(state).toMatch(/^[\w-]{32}$/);

    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', maxAge: 600 });
    expect(cookie.value).not.toBe(state); // signed, not the raw state
    expect(app.unsignCookie(cookie.value)).toMatchObject({ valid: true, value: state });
  });
});

describe('GET /api/auth/strava/callback', () => {
  it('exchanges the code, saves the Runner and tokens, and starts a session', async () => {
    const athleteId = randomAthleteId();
    const { res, session } = await signIn(athleteId, 'read,activity:read_all');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const body = fetch.mock.calls[0]![1]!.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');

    const [runner] = await db.select().from(runners).where(eq(runners.stravaAthleteId, athleteId));
    expect(runner).toMatchObject({
      firstName: 'Paula',
      sex: 'F',
      avatarUrl: 'https://example.com/paula.jpg',
      isSubscriber: true,
    });
    const [tokens] = await db
      .select()
      .from(stravaTokens)
      .where(eq(stravaTokens.runnerId, runner!.id));
    expect(tokens).toMatchObject({
      expiresAt: new Date(2_000_000_000 * 1000),
      // Only what the Runner actually granted, not everything myKOM asked for.
      grantedScopes: ['read', 'activity:read_all'],
    });
    // Encrypted at rest.
    expect(tokens!.accessToken).not.toContain('access-1');
    expect(tokens!.refreshToken).not.toContain('refresh-1');
    expect(testTokenCipher.decrypt(tokens!.accessToken)).toBe('access-1');
    expect(testTokenCipher.decrypt(tokens!.refreshToken)).toBe('refresh-1');
  });

  it('updates the same Runner when they sign in again', async () => {
    const athleteId = randomAthleteId();
    await signIn(athleteId);

    fetch.mockResolvedValueOnce(
      tokenResponse(athleteId, {
        access_token: 'access-2',
        athlete: { id: athleteId, firstname: 'Paula R', sex: null, profile: 'avatar/large.png' },
      }),
    );
    const { cookie, state } = await startSignIn();
    const res = await callback({ code: 'code-2', state, scope: 'read' }, cookie.value);
    expect(res.headers.location).toBe('/');

    const rows = await db.select().from(runners).where(eq(runners.stravaAthleteId, athleteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      firstName: 'Paula R',
      sex: null,
      avatarUrl: null,
      isSubscriber: false,
    });
    const [tokens] = await db
      .select()
      .from(stravaTokens)
      .where(eq(stravaTokens.runnerId, rows[0]!.id));
    expect(testTokenCipher.decrypt(tokens!.accessToken)).toBe('access-2');
    expect(tokens!.grantedScopes).toEqual(['read']);
  });

  it('rejects a state that does not match the cookie', async () => {
    const { cookie } = await startSignIn();
    const res = await callback({ code: 'the-code', state: 'forged', scope: 'read' }, cookie.value);

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?error=invalid_state');
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a callback with no state cookie', async () => {
    const { state } = await startSignIn();
    const res = await callback({ code: 'the-code', state, scope: 'read' });
    expect(res.headers.location).toBe('/login?error=invalid_state');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a state cookie that was tampered with', async () => {
    const { state } = await startSignIn();
    const res = await callback({ code: 'the-code', state, scope: 'read' }, `${state}.forged`);
    expect(res.headers.location).toBe('/login?error=invalid_state');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the Runner back to login when they deny access on Strava', async () => {
    const { cookie, state } = await startSignIn();
    const res = await callback({ error: 'access_denied', state }, cookie.value);
    expect(res.headers.location).toBe('/login?error=access_denied');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the Runner back to login when Strava rejects the code', async () => {
    fetch.mockResolvedValueOnce(new Response('{"message":"Bad Request"}', { status: 400 }));
    const { cookie, state } = await startSignIn();
    const res = await callback({ code: 'bad-code', state, scope: 'read' }, cookie.value);
    expect(res.headers.location).toBe('/login?error=strava');
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });
});

describe('GET /api/me', () => {
  it('returns 401 when signed out', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a session cookie that was tampered with', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: '1.forged-signature' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the signed-in Runner', async () => {
    const { session } = await signIn(randomAthleteId());
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: session!.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: expect.any(Number),
      firstName: 'Paula',
      avatarUrl: 'https://example.com/paula.jpg',
    });
  });

  it('returns 401 and clears the session once the Runner no longer exists', async () => {
    const athleteId = randomAthleteId();
    const { session } = await signIn(athleteId);
    await db.delete(runners).where(eq(runners.stravaAthleteId, athleteId));

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: session!.value },
    });
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({ value: '' });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const { session } = await signIn(randomAthleteId());
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: session!.value },
    });
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cleared).toMatchObject({ value: '', path: '/' });
    expect(cleared!.expires!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('POST /api/auth/disconnect', () => {
  async function disconnect(session?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/disconnect',
      cookies: session ? { [SESSION_COOKIE]: session } : {},
    });
  }

  async function runnerData(runnerId: number) {
    return {
      runners: await db.select().from(runners).where(eq(runners.id, runnerId)),
      tokens: await db.select().from(stravaTokens).where(eq(stravaTokens.runnerId, runnerId)),
    };
  }

  it('returns 401 when signed out', async () => {
    const res = await disconnect();
    expect(res.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deauthorizes on Strava, deletes the Runner's data and clears the session", async () => {
    const { runnerId, session } = await signInRunner();
    const before = await runnerData(runnerId);
    expect(before.runners).toHaveLength(1);
    expect(before.tokens).toHaveLength(1);
    fetch.mockResolvedValueOnce(Response.json({ access_token: 'access-1' }));

    const res = await disconnect(session);

    expect(res.statusCode).toBe(204);
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe(STRAVA_DEAUTHORIZE_URL);
    expect((init!.body as URLSearchParams).get('access_token')).toBe('access-1');

    expect(await runnerData(runnerId)).toEqual({ runners: [], tokens: [] });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({ value: '' });

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.statusCode).toBe(401);
  });

  it('refreshes an expired stored token before deauthorizing', async () => {
    const athleteId = randomAthleteId();
    athleteIds.push(athleteId);
    fetch.mockResolvedValueOnce(tokenResponse(athleteId, { expires_at: 1_000_000_000 }));
    const { cookie, state } = await startSignIn();
    const login = await callback({ code: 'the-code', state, scope: 'read' }, cookie.value);
    const session = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
    fetch
      .mockResolvedValueOnce(
        Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_at: 2e9 }),
      )
      .mockResolvedValueOnce(Response.json({}));

    const res = await disconnect(session);

    expect(res.statusCode).toBe(204);
    const [refreshBody, deauthorizeBody] = fetch.mock.calls
      .slice(1)
      .map(([, init]) => init!.body as URLSearchParams);
    expect(refreshBody!.get('refresh_token')).toBe('refresh-1');
    expect(deauthorizeBody!.get('access_token')).toBe('access-2');
  });

  it('empties every per-Runner table and keeps the shared Segment', async () => {
    const { runnerId, session } = await signInRunner();
    const segmentId = 8_000_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
    await seedEverything(runnerId, segmentId);
    const before = await perRunnerCounts(runnerId);
    expect(Object.entries(before).filter(([, count]) => count !== 1)).toEqual([]);
    // Every table that references runners is covered above.
    const referencing = await db.execute<{ table_name: string }>(sql`
      select distinct c.conrelid::regclass::text as table_name
      from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'runners'::regclass
      order by 1`);
    expect(referencing.map((r) => r.table_name)).toEqual([...perRunnerTableNames].sort());
    fetch.mockResolvedValueOnce(Response.json({}));

    const res = await disconnect(session);

    expect(res.statusCode).toBe(204);
    const after = await perRunnerCounts(runnerId);
    expect(Object.entries(after).filter(([, count]) => count !== 0)).toEqual([]);
    expect(await db.$count(segments, eq(segments.id, segmentId))).toBe(1);
    await db.delete(segments).where(eq(segments.id, segmentId));
  });

  it("still deletes the Runner's data when Strava's deauthorize fails", async () => {
    const { runnerId, session } = await signInRunner();
    fetch.mockResolvedValueOnce(new Response('{"message":"Authorization Error"}', { status: 401 }));

    const res = await disconnect(session);

    expect(res.statusCode).toBe(204);
    expect(await runnerData(runnerId)).toEqual({ runners: [], tokens: [] });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({ value: '' });
  });
});

describe('revoked Strava access', () => {
  /** A token that has expired, so the next Strava read refreshes it first. */
  const expired = { expires_at: 1_000_000_000 };
  const invalidGrant = () => Response.json({ error: 'invalid_grant' }, { status: 400 });

  /** Seeds a Runner with a row in every per-Runner table; returns their id, session and Segment. */
  async function seededRunner(tokens: Record<string, unknown> = {}) {
    const { runnerId, session } = await signInRunner(tokens);
    const segmentId = 8_000_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
    await seedEverything(runnerId, segmentId);
    return { runnerId, session, segmentId };
  }

  async function me(session: string) {
    return app.inject({ method: 'GET', url: '/api/me', cookies: { [SESSION_COOKIE]: session } });
  }

  /** A route that reads the signed-in Runner's activities, as the real ones will. Add it before the first inject. */
  function addReadRoute() {
    app.get('/api/read-activities', async (request) => {
      await strava.listActivities(sessionRunnerId(request)!, { page: 1 });
      return { ok: true };
    });
  }

  it('a refresh rejected with invalid_grant deletes everything, and /api/me is 401', async () => {
    const { runnerId, session, segmentId } = await seededRunner(expired);
    fetch.mockResolvedValueOnce(invalidGrant());

    // As a background job would call it: no request involved.
    const error = await strava.listActivities(runnerId, { page: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StravaRevokedError);
    const after = await perRunnerCounts(runnerId);
    expect(Object.entries(after).filter(([, count]) => count !== 0)).toEqual([]);
    expect(await db.$count(segments, eq(segments.id, segmentId))).toBe(1);
    await db.delete(segments).where(eq(segments.id, segmentId));
    const res = await me(session);
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({ value: '' });
  });

  it('a request that hits the revocation deletes the Runner, ends the session and is 401', async () => {
    addReadRoute();
    const { runnerId, session, segmentId } = await seededRunner(expired);
    fetch.mockResolvedValueOnce(invalidGrant());

    const res = await app.inject({
      method: 'GET',
      url: '/api/read-activities',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'signed_out' });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({ value: '' });
    expect(await db.$count(runners, eq(runners.id, runnerId))).toBe(0);
    await db.delete(segments).where(eq(segments.id, segmentId));
    expect((await me(session)).statusCode).toBe(401);
  });

  it('a read refused with 401 deletes the Runner too', async () => {
    addReadRoute();
    const { runnerId, session } = await signInRunner();
    fetch.mockResolvedValueOnce(
      Response.json({ message: 'Authorization Error', errors: [] }, { status: 401 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/read-activities',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(res.statusCode).toBe(401);
    expect(await db.$count(runners, eq(runners.id, runnerId))).toBe(0);
  });

  it('other Strava errors keep the Runner and their session, and are a 502', async () => {
    addReadRoute();
    const { runnerId, session } = await signInRunner();
    // A scope the Runner didn't grant is not a revocation.
    fetch.mockResolvedValueOnce(
      Response.json(
        {
          message: 'Authorization Error',
          errors: [{ resource: 'AccessToken', field: 'activity:read_permission', code: 'missing' }],
        },
        { status: 401 },
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/read-activities',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'strava' });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    expect(await db.$count(runners, eq(runners.id, runnerId))).toBe(1);
    expect((await me(session)).statusCode).toBe(200);
  });

  it("leaves other errors to Fastify's default handler", async () => {
    app.get('/api/boom', async () => {
      throw new Error('boom');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
  });

  it('disconnect with a revoked refresh token still deletes and signs out', async () => {
    const { runnerId, session } = await signInRunner(expired);
    fetch.mockResolvedValueOnce(invalidGrant());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/disconnect',
      cookies: { [SESSION_COOKIE]: session },
    });

    expect(res.statusCode).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(2); // sign-in, then the rejected refresh; no deauthorize
    expect(await db.$count(runners, eq(runners.id, runnerId))).toBe(0);
  });
});
