// Live tests against the real Strava account (`pnpm test:live`, never part of `pnpm test`).
//
// They use the live token store (live-token-store.ts) and make at most MAX_STRAVA_CALLS calls.
// Never print a token: assertions that compare tokens only ever show true/false, and the log
// lines name athlete ids, first names, paths and rate-limit usage, nothing else.
// Never call deauthorize here: it would revoke the live token.

import { TransactionRollbackError, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { upsertRunnerFromStrava } from '../auth/runners.js';
import { runners, stravaTokens, type Runner } from '../db/schema.js';
import { loadRootEnvFile, readEnv } from '../env.js';
import { useTestDatabase } from '../test/app.js';
import {
  REFRESH_WINDOW_MS,
  STRAVA_ATHLETE_URL,
  STRAVA_SCOPES,
  createStravaClient,
  type StravaTokenSet,
  type StravaTokenStore,
} from './client.js';
import { createLiveTokenStore } from './live-token-store.js';

/** A hard cap, well inside Strava's 100 reads per 15 minutes shared by everything. */
const MAX_STRAVA_CALLS = 5;
const RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit',
  'x-ratelimit-usage',
  'x-readratelimit-limit',
  'x-readratelimit-usage',
];
/** The live store ignores Runner ids. */
const LIVE_RUNNER = 0;

loadRootEnvFile();
const { stravaClientId, stravaClientSecret } = readEnv();
const liveToken = await createLiveTokenStore().read();
const skipReason =
  !stravaClientId || !stravaClientSecret
    ? 'STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are not set in .env'
    : !liveToken
      ? 'there is no live token: set STRAVA_REFRESH_TOKEN in .env, or run `pnpm strava:authorize`'
      : undefined;
if (skipReason) console.warn(`Skipping the live Strava tests: ${skipReason}.`);

const calls: string[] = [];
const rateLimits = new Map<string, string>();
let athleteBody: unknown;

/** The real fetch, counting calls against the budget and noting rate-limit usage. */
const recordingFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const call = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
  if (calls.length >= MAX_STRAVA_CALLS) {
    throw new Error(`Live test call budget (${MAX_STRAVA_CALLS}) used up before ${call}`);
  }
  const res = await fetch(input, init);
  calls.push(`${call} -> ${res.status}`);
  for (const name of RATE_LIMIT_HEADERS) {
    const value = res.headers.get(name);
    if (value) rateLimits.set(name, value);
  }
  if (url === STRAVA_ATHLETE_URL && res.ok) {
    athleteBody = await res
      .clone()
      .json()
      .catch(() => undefined);
  }
  return res;
};

function liveClient(tokenStore: StravaTokenStore = createLiveTokenStore()) {
  return createStravaClient({
    clientId: stravaClientId,
    clientSecret: stravaClientSecret,
    tokenStore,
    fetch: recordingFetch,
  });
}

afterAll(() => {
  if (skipReason) return;
  const usage = [...rateLimits].map(([name, value]) => `  ${name}: ${value}`);
  console.log(
    [
      `Strava calls made: ${calls.length}`,
      ...calls.map((call) => `  ${call}`),
      'Rate limits (15 min, daily) after the run:',
      ...(usage.length > 0 ? usage : ['  (no rate-limit headers seen)']),
    ].join('\n'),
  );
});

describe.skipIf(skipReason !== undefined)('live Strava account', () => {
  const database = useTestDatabase();

  it('refreshes the live token and persists the rotated token set', async () => {
    // Report the stored token as expired so the real refresh path runs on every live run.
    const store = createLiveTokenStore();
    const saved: StravaTokenSet[] = [];
    const client = liveClient({
      async load(runnerId) {
        const tokens = await store.load(runnerId);
        return tokens && { ...tokens, expiresAt: new Date(0) };
      },
      async save(runnerId, tokens) {
        saved.push(tokens);
        await store.save(runnerId, tokens);
      },
    });

    const accessToken = await client.getValidAccessToken(LIVE_RUNNER);
    expect(accessToken.length > 0, 'got an access token').toBe(true);
    expect(saved.length, 'the refreshed token set was saved').toBe(1);
    const rotated = saved[0]!;
    expect(rotated.expiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS).toBe(true);

    // A new store reads the file, which must now hold exactly the rotated set.
    const onFile = await createLiveTokenStore().read();
    expect(
      onFile !== undefined &&
        onFile.accessToken === rotated.accessToken &&
        onFile.refreshToken === rotated.refreshToken &&
        onFile.expiresAt.getTime() === Math.floor(rotated.expiresAt.getTime() / 1000) * 1000,
      'the token file holds the rotated token set',
    ).toBe(true);
    expect(onFile?.scopes, 'the refresh kept the recorded scopes').toEqual(liveToken?.scopes);

    // And a fresh client uses it as-is, without another refresh.
    const callsBefore = calls.length;
    const again = await liveClient().getValidAccessToken(LIVE_RUNNER);
    expect(again === accessToken, 'the fresh client got the persisted access token').toBe(true);
    expect(calls.length).toBe(callsBefore);
  });

  it('GET /athlete has the fields myKOM relies on and maps to a valid Runner', async () => {
    const client = liveClient();
    const store = createLiveTokenStore();
    const athlete = await client.getAthlete(await client.getValidAccessToken(LIVE_RUNNER));
    console.log(`Live athlete: ${athlete.id} (${athlete.firstName})`);

    expect(athleteBody).toBeTypeOf('object');
    const body = athleteBody as Record<string, unknown>;
    expect(body.id).toBeTypeOf('number');
    expect(body.firstname).toBeTypeOf('string');
    expect(body).toHaveProperty('sex');
    expect(body.sex === null || typeof body.sex === 'string', 'sex is a string or null').toBe(true);
    expect(body.profile).toBeTypeOf('string');
    expect(
      typeof body.summit === 'boolean' || typeof body.premium === 'boolean',
      'athlete has a summit or premium subscriber flag',
    ).toBe(true);

    // Save it exactly as the OAuth callback does, inside a transaction that is rolled back.
    const tokens = await store.load(LIVE_RUNNER);
    const grantedScopes = (await store.read())?.scopes ?? [];
    let runner: Runner | undefined;
    let savedScopes: string[] | undefined;
    await database.db
      .transaction(async (tx) => {
        const runnerId = await upsertRunnerFromStrava(tx, { ...tokens!, athlete }, grantedScopes);
        [runner] = await tx.select().from(runners).where(eq(runners.id, runnerId));
        const [tokenRow] = await tx
          .select({ grantedScopes: stravaTokens.grantedScopes })
          .from(stravaTokens)
          .where(eq(stravaTokens.runnerId, runnerId));
        savedScopes = tokenRow?.grantedScopes;
        tx.rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof TransactionRollbackError)) throw error;
      });

    expect(runner).toMatchObject({
      stravaAthleteId: body.id,
      firstName: body.firstname,
      sex: body.sex === 'M' || body.sex === 'F' ? body.sex : null,
      isSubscriber: body.summit === true || body.premium === true,
    });
    expect(runner!.firstName.length).toBeGreaterThan(0);
    expect(runner!.avatarUrl === null || /^https:\/\//.test(runner!.avatarUrl)).toBe(true);
    expect(savedScopes).toEqual(grantedScopes);

    const left = await database.db
      .select({ id: runners.id })
      .from(runners)
      .where(eq(runners.stravaAthleteId, athlete.id));
    expect(left, 'the rolled-back Runner is not in the database').toEqual([]);
  });

  it('the live token was granted every scope myKOM asks for', async (context) => {
    const scopes = (await createLiveTokenStore().read())?.scopes;
    if (!scopes) {
      context.skip(
        'granted scopes are unknown for a token seeded from .env (Strava only reports them on ' +
          'the authorize redirect): run `pnpm strava:authorize` once to record them',
      );
      return;
    }
    expect(STRAVA_SCOPES.filter((scope) => !scopes.includes(scope))).toEqual([]);
  });
});
