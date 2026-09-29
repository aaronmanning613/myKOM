import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest';
import { runners, stravaTokens } from '../db/schema.js';
import { STRAVA_AUTHORIZE_URL, STRAVA_DEAUTHORIZE_URL } from '../strava/client.js';
import { buildTestApp, randomAthleteId, useTestDatabase } from '../test/app.js';
import { STATE_COOKIE } from './routes.js';
import { SESSION_COOKIE } from './session.js';

const database = useTestDatabase();
const { db } = database;
const athleteIds: number[] = [];

let app: FastifyInstance;
let fetch: Mock<typeof globalThis.fetch>;

beforeEach(() => {
  ({ app, fetch } = buildTestApp(database));
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
async function signIn(athleteId: number, scope = 'read,activity:read_all') {
  athleteIds.push(athleteId);
  fetch.mockResolvedValueOnce(tokenResponse(athleteId));
  const { cookie, state } = await startSignIn();
  const res = await callback({ code: 'the-code', state, scope }, cookie.value);
  return { res, session: res.cookies.find((c) => c.name === SESSION_COOKIE) };
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
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: new Date(2_000_000_000 * 1000),
      // Only what the Runner actually granted, not everything myKOM asked for.
      grantedScopes: ['read', 'activity:read_all'],
    });
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
    expect(tokens).toMatchObject({ accessToken: 'access-2', grantedScopes: ['read'] });
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

  /** Signs a Runner in and returns their id and session cookie value. */
  async function signInRunner() {
    const athleteId = randomAthleteId();
    const { session } = await signIn(athleteId);
    const [runner] = await db.select().from(runners).where(eq(runners.stravaAthleteId, athleteId));
    return { runnerId: runner!.id, session: session!.value };
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

  it("still deletes the Runner's data when Strava's deauthorize fails", async () => {
    const { runnerId, session } = await signInRunner();
    fetch.mockResolvedValueOnce(new Response('{"message":"Authorization Error"}', { status: 401 }));

    const res = await disconnect(session);

    expect(res.statusCode).toBe(204);
    expect(await runnerData(runnerId)).toEqual({ runners: [], tokens: [] });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toMatchObject({ value: '' });
  });
});
