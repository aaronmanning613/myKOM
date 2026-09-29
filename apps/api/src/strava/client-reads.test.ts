// The Strava reads, over fixtures captured from the live account (scrubbed: only the fields
// myKOM reads; made-up run routes; no other athlete's name or photo).

import { readFileSync } from 'node:fs';
import { decodePolyline } from '@mykom/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  STRAVA_API_URL,
  STRAVA_PAGE_SIZE,
  STRAVA_TOKEN_URL,
  StravaError,
  StravaRateLimitError,
  StravaRevokedError,
  createStravaClient,
  type StravaTokenSet,
} from './client.js';

const NOW = new Date('2026-09-29T14:07:00Z');
const RUNNER = 1;

type Fixture = 'activities' | 'activity' | 'segment' | 'starred';
const fixtureHeaders = JSON.parse(
  readFileSync(new URL('./fixtures/rate-limit-headers.json', import.meta.url), 'utf8'),
) as Record<Fixture, Record<string, string>>;

/** The fixture's body as Strava sent it: raw text, so effort ids past 2^53 stay exact. */
function fixtureText(name: Fixture): string {
  return readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
}

function fixtureResponse(name: Fixture, body = fixtureText(name)) {
  return new Response(body, {
    headers: { 'content-type': 'application/json', ...fixtureHeaders[name] },
  });
}

/** A fixture's body parsed (lossily) for editing into variants. */
function fixtureJson(name: Fixture): Record<string, unknown> {
  return JSON.parse(fixtureText(name)) as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function setup(expiresAt = new Date(NOW.getTime() + 60 * 60 * 1000)) {
  const tokens = new Map<number, StravaTokenSet>([
    [RUNNER, { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt }],
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createStravaClient({
    clientId: '123',
    clientSecret: 'shh',
    tokenStore: {
      load: async (runnerId) => tokens.get(runnerId),
      save: async (runnerId, set) => {
        tokens.set(runnerId, set);
      },
    },
    fetch,
    now: () => NOW,
  });
  return { client, fetch, tokens };
}

function requested(fetch: ReturnType<typeof setup>['fetch'], call = 0) {
  const [url, init] = fetch.mock.calls[call]!;
  return {
    url: new URL(String(url)),
    authorization: new Headers(init?.headers).get('authorization'),
  };
}

const FIXTURE_RATE_LIMITS = {
  overall: { limit: { window: 200, day: 2000 }, usage: { window: 1, day: 3 } },
  read: { limit: { window: 100, day: 1000 }, usage: { window: 1, day: 3 } },
};

describe('listActivities', () => {
  it('maps a page of the activity list, with the polyline bounding box and rate limits', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(fixtureResponse('activities'));

    const { data, rateLimits } = await client.listActivities(RUNNER, { page: 1 });

    expect(rateLimits).toEqual(FIXTURE_RATE_LIMITS);
    expect(data.map((a) => [a.id, a.sportType])).toEqual([
      [20377567085, 'Run'],
      [20295654760, 'Run'],
      [20302652195, 'Workout'],
      [20274514043, 'Ride'],
    ]);
    const [run, treadmill] = data;
    expect(run).toMatchObject({
      name: 'Morning Run',
      startDate: '2026-09-29T11:11:55Z',
      distance: 17027.7,
      // Moving time, not the 4856 s elapsed.
      movingTime: 4687,
    });
    const points = decodePolyline(run!.summaryPolyline!);
    expect(run!.bbox).toEqual({
      minLat: Math.min(...points.map((p) => p.lat)),
      minLng: Math.min(...points.map((p) => p.lng)),
      maxLat: Math.max(...points.map((p) => p.lat)),
      maxLng: Math.max(...points.map((p) => p.lng)),
    });
    // No GPS: Strava sends an empty polyline.
    expect(treadmill).toMatchObject({ distance: 3500, summaryPolyline: null, bbox: null });
    // Nothing but our own shape survives.
    expect(Object.keys(run!).sort()).toEqual(
      [
        'bbox',
        'distance',
        'id',
        'movingTime',
        'name',
        'sportType',
        'startDate',
        'summaryPolyline',
      ].sort(),
    );

    const { url, authorization } = requested(fetch);
    expect(url.origin + url.pathname).toBe(`${STRAVA_API_URL}/athlete/activities`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '1',
      per_page: String(STRAVA_PAGE_SIZE),
    });
    expect(authorization).toBe('Bearer access-1');
  });

  it('sends `after` as epoch seconds', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse([]));
    const { data } = await client.listActivities(RUNNER, {
      after: new Date('2026-09-28T10:00:00.900Z'),
      page: 3,
    });
    expect(data).toEqual([]);
    const { url } = requested(fetch);
    expect(url.searchParams.get('after')).toBe(String(Date.UTC(2026, 8, 28, 10) / 1000));
    expect(url.searchParams.get('page')).toBe('3');
  });

  it('refreshes an expiring token before reading', async () => {
    const { client, fetch, tokens } = setup(new Date(NOW.getTime() + 60 * 1000));
    fetch
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_at: NOW.getTime() / 1000 + 21600,
        }),
      )
      .mockResolvedValueOnce(fixtureResponse('activities'));
    await client.listActivities(RUNNER, { page: 1 });
    expect(String(fetch.mock.calls[0]![0])).toBe(STRAVA_TOKEN_URL);
    expect(requested(fetch, 1).authorization).toBe('Bearer access-2');
    expect(tokens.get(RUNNER)?.accessToken).toBe('access-2');
  });

  it('throws a StravaError when the list is not a list', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ message: 'nope' }));
    await expect(client.listActivities(RUNNER, { page: 1 })).rejects.toThrow(StravaError);
  });
});

describe('getActivity', () => {
  it('maps the DetailedActivity and its efforts with exact effort ids and hints', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(fixtureResponse('activity'));

    const { data, rateLimits } = await client.getActivity(RUNNER, 20377567085);

    expect(rateLimits.read?.usage).toEqual({ window: 2, day: 4 });
    expect(data).toMatchObject({ id: 20377567085, sportType: 'Run', movingTime: 4687 });
    expect(data.bbox).not.toBeNull();
    expect(data.efforts).toHaveLength(3);
    const [pr, plain, topTen] = data.efforts;
    // Past Number.MAX_SAFE_INTEGER, so read as a string from the raw digits.
    expect(pr!.id).toBe('3539994790397326017');
    expect(pr).toMatchObject({
      activityId: 20377567085,
      elapsedTime: 131,
      startDate: '2026-09-29T11:18:01Z',
      komRank: null,
      // A PR is not a record achievement.
      recordAchievement: false,
    });
    expect(pr!.segment).toEqual({
      id: 8793341,
      name: 'Joe Shuster Wayyy',
      activityType: 'Run',
      distance: 499.9,
      averageGrade: 1.2,
      maximumGrade: 3.3,
      elevationHigh: 90.8,
      elevationLow: 84.9,
      start: { lat: 43.639712, lng: -79.42358 },
      end: { lat: 43.641716, lng: -79.428409 },
      hazardous: false,
    });
    expect(plain).toMatchObject({ komRank: null, recordAchievement: false });
    expect(topTen).toMatchObject({
      id: '3539994790397328017',
      komRank: 5,
      recordAchievement: true,
    });

    const { url } = requested(fetch);
    expect(url.pathname).toBe('/api/v3/activities/20377567085');
    expect(url.searchParams.get('include_all_efforts')).toBe('true');
  });

  it('counts an overall_cr achievement as a record achievement, and allows no efforts', async () => {
    const { client, fetch } = setup();
    const body = fixtureJson('activity');
    const [effort] = body.segment_efforts as Record<string, unknown>[];
    body.segment_efforts = [
      { ...effort, id: 12, kom_rank: null, achievements: [{ type: 'overall_cr', rank: 1 }] },
    ];
    fetch.mockResolvedValueOnce(jsonResponse(body));
    const { data } = await client.getActivity(RUNNER, 1);
    expect(data.efforts[0]).toMatchObject({ id: '12', komRank: null, recordAchievement: true });

    delete body.segment_efforts;
    fetch.mockResolvedValueOnce(jsonResponse(body));
    expect((await client.getActivity(RUNNER, 1)).data.efforts).toEqual([]);
  });
});

describe('getSegment', () => {
  it('maps the Segment details, xoms, athlete stats, and drops everything else', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(fixtureResponse('segment'));

    const { data, rateLimits } = await client.getSegment(RUNNER, 8793341);

    expect(rateLimits.read?.usage).toEqual({ window: 3, day: 5 });
    expect(data).toEqual({
      id: 8793341,
      name: 'Joe Shuster Wayyy',
      activityType: 'Run',
      distance: 499.9,
      averageGrade: 1.2,
      maximumGrade: 3.3,
      elevationHigh: 90.8,
      elevationLow: 84.9,
      start: { lat: 43.639712, lng: -79.42358 },
      end: { lat: 43.641716, lng: -79.428409 },
      hazardous: false,
      totalElevationGain: 6,
      polyline: expect.any(String),
      athleteCount: 1842,
      xoms: { kom: '58s', qom: '1:27' },
      athleteStats: { prElapsedTime: 127, prDate: '2026-09-07' },
    });
    expect(requested(fetch).url.pathname).toBe('/api/v3/segments/8793341');
  });

  it('never keeps the local legend, and maps a hazardous Segment without records or stats', async () => {
    const { client, fetch } = setup();
    const body = {
      ...fixtureJson('segment'),
      hazardous: true,
      xoms: undefined,
      athlete_segment_stats: undefined,
      local_legend: { athlete_id: 7, title: 'Someone Else', profile: 'https://example.com/p.jpg' },
    };
    fetch.mockResolvedValue(jsonResponse(body));
    const { data } = await client.getSegment(RUNNER, 8793341);
    expect(data).toMatchObject({ hazardous: true, xoms: null, athleteStats: null });
    expect(JSON.stringify(data)).not.toContain('Someone Else');
    expect(JSON.stringify(data)).not.toContain('example.com');
  });

  it('keeps a missing gender as null and the raw strings as sent', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse({ ...fixtureJson('segment'), xoms: { kom: '1:02:03', overall: '1:02:03' } }),
    );
    expect((await client.getSegment(RUNNER, 1)).data.xoms).toEqual({ kom: '1:02:03', qom: null });
  });
});

describe('getStarredSegments', () => {
  it('maps a page of starred Segments', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(fixtureResponse('starred'));

    const { data, rateLimits } = await client.getStarredSegments(RUNNER, 2);

    expect(rateLimits.read?.usage).toEqual({ window: 4, day: 6 });
    expect(data.map((s) => s.id)).toEqual([2309643, 2667989]);
    expect(data[0]).toMatchObject({
      name: 'Ave Revolution Climb',
      activityType: 'Run',
      averageGrade: 5.1,
      maximumGrade: 20.2,
      start: { lat: 20.858193710446358, lng: -105.45452783815563 },
    });
    const { url } = requested(fetch);
    expect(url.pathname).toBe('/api/v3/segments/starred');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      per_page: String(STRAVA_PAGE_SIZE),
    });
  });
});

describe('rate limits', () => {
  it('are null when Strava sends no or malformed headers', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse([], 200, { 'x-ratelimit-limit': '200,2000', 'x-ratelimit-usage': 'lots' }),
    );
    expect((await client.getStarredSegments(RUNNER, 1)).rateLimits).toEqual({
      overall: null,
      read: null,
    });
  });

  it('a 429 is a StravaRateLimitError retrying at the next 15-minute window', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse({ message: 'Rate Limit Exceeded' }, 429, {
        'x-ratelimit-limit': '200,2000',
        'x-ratelimit-usage': '101,500',
        'x-readratelimit-limit': '100,1000',
        'x-readratelimit-usage': '101,500',
      }),
    );
    const error = await client.getSegment(RUNNER, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaRateLimitError);
    expect(error).toBeInstanceOf(StravaError);
    const limited = error as StravaRateLimitError;
    expect(limited.status).toBe(429);
    // NOW is 14:07 UTC.
    expect(limited.retryAt).toEqual(new Date('2026-09-29T14:15:00Z'));
    expect(limited.rateLimits.read?.usage).toEqual({ window: 101, day: 500 });
  });

  it('a 429 with the daily read limit used up retries at midnight UTC', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse({ message: 'Rate Limit Exceeded' }, 429, {
        'x-readratelimit-limit': '100,1000',
        'x-readratelimit-usage': '40,1000',
      }),
    );
    const error = (await client
      .listActivities(RUNNER, { page: 1 })
      .catch((e: unknown) => e)) as StravaRateLimitError;
    expect(error.retryAt).toEqual(new Date('2026-09-30T00:00:00Z'));
  });

  it('a 429 without headers retries at the next window', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ message: 'Rate Limit Exceeded' }, 429));
    const error = (await client
      .getActivity(RUNNER, 1)
      .catch((e: unknown) => e)) as StravaRateLimitError;
    expect(error.retryAt).toEqual(new Date('2026-09-29T14:15:00Z'));
    expect(error.rateLimits).toEqual({ overall: null, read: null });
  });
});

describe('revoked', () => {
  const expiring = new Date(NOW.getTime() + 60 * 1000);

  it('a refresh rejected with invalid_grant is a StravaRevokedError, and nothing is read', async () => {
    const { client, fetch, tokens } = setup(expiring);
    fetch.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400));
    const error = await client.getSegment(RUNNER, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaRevokedError);
    expect(error).toMatchObject({ runnerId: RUNNER, status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tokens.get(RUNNER)?.refreshToken).toBe('refresh-1');
  });

  it("a refresh rejected with Strava's invalid refresh_token error is revoked too", async () => {
    const { client, fetch } = setup(expiring);
    fetch.mockResolvedValue(
      jsonResponse(
        {
          message: 'Bad Request',
          errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }],
        },
        400,
      ),
    );
    await expect(client.getValidAccessToken(RUNNER)).rejects.toThrow(StravaRevokedError);
  });

  it('a refresh rejected for a bad client id or secret is not a revocation', async () => {
    const { client, fetch } = setup(expiring);
    fetch.mockResolvedValue(
      jsonResponse(
        {
          message: 'Authorization Error',
          errors: [{ resource: 'Application', field: 'client_id', code: 'invalid' }],
        },
        401,
      ),
    );
    const error = await client.listActivities(RUNNER, { page: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaError);
    expect(error).not.toBeInstanceOf(StravaRevokedError);
  });

  it('a 401 on a read is a StravaRevokedError', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse(
        {
          message: 'Authorization Error',
          errors: [{ resource: 'AccessToken', field: 'access_token', code: 'invalid' }],
        },
        401,
      ),
    );
    const error = await client.getActivity(RUNNER, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaRevokedError);
    expect(error).toMatchObject({ runnerId: RUNNER, status: 401 });
  });

  it('a 401 for an ungranted scope is not a revocation', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(
      jsonResponse(
        {
          message: 'Authorization Error',
          errors: [{ resource: 'AccessToken', field: 'activity:read_permission', code: 'missing' }],
        },
        401,
      ),
    );
    const error = await client.listActivities(RUNNER, { page: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaError);
    expect(error).not.toBeInstanceOf(StravaRevokedError);
    expect((error as StravaError).status).toBe(401);
  });

  it('other failures stay plain StravaErrors with the status', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValue(jsonResponse({ message: 'Record Not Found' }, 404));
    const error = await client.getSegment(RUNNER, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StravaError);
    expect(error).not.toBeInstanceOf(StravaRevokedError);
    expect((error as StravaError).status).toBe(404);
  });
});
