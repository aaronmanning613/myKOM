import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appState } from '../db/schema.js';
import { createJobQueue } from '../jobs/queue.js';
import { createTick } from '../jobs/tick.js';
import { buildTestApp, useOwnTestDatabase } from '../test/app.js';
import { createGoogleOidcVerifier, GOOGLE_JWKS_URL } from './google-oidc.js';

const { database } = useOwnTestDatabase();

const AUDIENCE = 'https://mykom-abc123.run.app';
const SCHEDULER = 'tick-scheduler@mykom.iam.gserviceaccount.com';

function rsaKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}
const google = rsaKey('google-key-1');
const stranger = rsaKey('stranger-key');

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A Google-style ID token as Cloud Scheduler sends it, with any claim overridden. */
function idToken(
  claims: Record<string, unknown> = {},
  {
    key = google.privateKey,
    kid = google.kid,
    alg = 'RS256',
  }: { key?: KeyObject; kid?: string; alg?: string } = {},
) {
  const seconds = Math.floor(Date.now() / 1000);
  const header = base64url({ alg, kid, typ: 'JWT' });
  const payload = base64url({
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    sub: '1234567890',
    email: SCHEDULER,
    email_verified: true,
    iat: seconds - 10,
    exp: seconds + 3600,
    ...claims,
  });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString(
    'base64url',
  );
  return `${header}.${payload}.${signature}`;
}

function setup({ allowWithoutToken = false } = {}) {
  const { db } = database();
  // Google's JWKS endpoint, stubbed with the local key.
  const jwksFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json({ keys: [google.jwk] }));
  const verifyToken = createGoogleOidcVerifier({
    audience: AUDIENCE,
    serviceAccountEmail: SCHEDULER,
    fetch: jwksFetch,
  });
  const { app, strava } = buildTestApp(database(), {
    tick: {
      tick: () => createTick({ db, queue: createJobQueue(db, {}), strava })(),
      verifyToken,
      allowWithoutToken,
    },
  });
  const post = (token?: string) =>
    app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  return { app, post, jwksFetch };
}

beforeEach(async () => {
  await database().db.delete(appState);
});

describe('POST /internal/tick', () => {
  it('runs the tick for the Scheduler’s token', async () => {
    const { post, jwksFetch } = setup();
    const response = await post(idToken());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      housekeeping: { freshnessQueued: 0 },
      drain: { succeeded: 0 },
    });
    expect(jwksFetch).toHaveBeenCalledWith(GOOGLE_JWKS_URL);
  });

  it('runs housekeeping only on the first tick of the day', async () => {
    const { post } = setup();
    expect((await post(idToken())).json().housekeeping).not.toBeNull();
    expect((await post(idToken())).json().housekeeping).toBeNull();
  });

  it('accepts the bare issuer and an audience list', async () => {
    const { post } = setup();
    const response = await post(idToken({ iss: 'accounts.google.com', aud: ['other', AUDIENCE] }));
    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['no token', undefined],
    ['garbage', 'not-a-token'],
    ['a malformed JWT', 'a.b.c'],
    ['the wrong audience', idToken({ aud: 'https://evil.example.com' })],
    ['the wrong issuer', idToken({ iss: 'https://evil.example.com' })],
    ['another service account', idToken({ email: 'someone@mykom.iam.gserviceaccount.com' })],
    ['an unverified email', idToken({ email_verified: false })],
    ['an expired token', idToken({ exp: Math.floor(Date.now() / 1000) - 600 })],
    ['a token from the future', idToken({ iat: Math.floor(Date.now() / 1000) + 600 })],
    ['a stranger’s key', idToken({}, { key: stranger.privateKey, kid: stranger.kid })],
    ['a stranger’s key under Google’s key id', idToken({}, { key: stranger.privateKey })],
    ['alg none', idToken({}, { alg: 'none' })],
  ])('refuses %s', async (_name, token) => {
    const { post } = setup();
    const response = await post(token);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
    const ran = await database().db.select().from(appState);
    expect(ran).toEqual([]);
  });

  it('refuses a tampered payload', async () => {
    const { post } = setup();
    const [header, , signature] = idToken().split('.');
    const payload = base64url({
      iss: 'https://accounts.google.com',
      aud: AUDIENCE,
      email: SCHEDULER,
    });
    expect((await post(`${header}.${payload}.${signature}`)).statusCode).toBe(401);
  });

  it('refuses every token when the OIDC settings are missing', async () => {
    const { app } = buildTestApp(database(), {
      tick: { tick: vi.fn() },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: { authorization: `Bearer ${idToken()}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('runs without a token in test mode', async () => {
    const { post } = setup({ allowWithoutToken: true });
    expect((await post()).statusCode).toBe(200);
  });

  it('ignores whatever body the Scheduler sends', async () => {
    const { app } = setup();
    const response = await app.inject({
      method: 'POST',
      url: '/internal/tick',
      headers: {
        authorization: `Bearer ${idToken()}`,
        'content-type': 'application/octet-stream',
      },
      payload: 'tick',
    });
    expect(response.statusCode).toBe(200);
  });

  it('isn’t registered without a tick', async () => {
    const { app } = buildTestApp(database());
    expect((await app.inject({ method: 'POST', url: '/internal/tick' })).statusCode).toBe(404);
  });
});
