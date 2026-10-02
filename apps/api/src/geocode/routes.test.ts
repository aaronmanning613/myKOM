import {
  MAX_GEOCODE_QUERY_LENGTH,
  type GeocodeResponse,
  type ReverseGeocodeResponse,
} from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { geocodeCache, runners } from '../db/schema.js';
import { NOMINATIM_REVERSE_URL, reverseCacheKey } from './nominatim.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';

const database = useTestDatabase();
const { db } = database;
const { app, nominatimFetch } = buildTestApp(database, { testRoutes: true });
const runnerIds: number[] = [];
const cachedQueries: string[] = [];

afterAll(async () => {
  await app.close();
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
  if (cachedQueries.length) {
    await db.delete(geocodeCache).where(inArray(geocodeCache.query, cachedQueries));
  }
});

beforeEach(() => {
  nominatimFetch.mockReset();
});

async function signIn(target = app) {
  const res = await target.inject({ method: 'POST', url: '/api/test/login' });
  const { id } = res.json<{ id: number }>();
  runnerIds.push(id);
  return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
}

/** A query no other test run has cached (tests share the database). */
function uniqueQuery(place: string) {
  const query = `${place} ${Math.random().toString(36).slice(2)}`;
  cachedQueries.push(query.toLowerCase());
  return query;
}

const geocode = (q: string | undefined, cookies?: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/api/geocode', query: q === undefined ? {} : { q }, cookies });

const leedsPlace = {
  lat: '53.7974185',
  lon: '-1.5437941',
  display_name: 'Leeds, West Yorkshire, England, United Kingdom',
};
const leeds = {
  label: 'Leeds, West Yorkshire, England, United Kingdom',
  lat: 53.7974185,
  lng: -1.5437941,
};

describe('GET /api/geocode', () => {
  it('is 401 when signed out, without calling Nominatim', async () => {
    const res = await geocode('Leeds');
    expect(res.statusCode).toBe(401);
    expect(nominatimFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(MAX_GEOCODE_QUERY_LENGTH + 1)],
  ])('rejects a %s query with 400', async (_name, q) => {
    const res = await geocode(q, await signIn());
    expect(res.statusCode).toBe(400);
    expect(nominatimFetch).not.toHaveBeenCalled();
  });

  it('returns Nominatim results as { label, lat, lng }', async () => {
    nominatimFetch.mockResolvedValue(Response.json([leedsPlace]));
    const res = await geocode(uniqueQuery('Leeds'), await signIn());
    expect(res.statusCode).toBe(200);
    expect(res.json<GeocodeResponse>()).toEqual({ results: [leeds] });
  });

  it('caches results in geocode_cache and serves repeats without calling Nominatim', async () => {
    const cookies = await signIn();
    const query = uniqueQuery('LS1');
    nominatimFetch.mockResolvedValue(Response.json([leedsPlace]));
    await geocode(query, cookies);
    expect(nominatimFetch).toHaveBeenCalledOnce();

    const [row] = await db
      .select()
      .from(geocodeCache)
      .where(eq(geocodeCache.query, query.toLowerCase()));
    expect(row?.results).toEqual([leeds]);

    const repeat = await geocode(`  ${query.toUpperCase()} `, cookies);
    expect(repeat.json()).toEqual({ results: [leeds] });
    expect(nominatimFetch).toHaveBeenCalledOnce();
  });

  it('returns an empty list when nothing matches', async () => {
    nominatimFetch.mockResolvedValue(Response.json([]));
    const res = await geocode(uniqueQuery('Nowhere'), await signIn());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ results: [] });
  });

  it('is 502 when Nominatim fails, and caches nothing', async () => {
    const cookies = await signIn();
    const query = uniqueQuery('York');
    nominatimFetch.mockResolvedValue(new Response('busy', { status: 503 }));
    const res = await geocode(query, cookies);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'geocode_failed' });
    const rows = await db
      .select()
      .from(geocodeCache)
      .where(eq(geocodeCache.query, query.toLowerCase()));
    expect(rows).toEqual([]);
  });

  it('is 503 when place search is unavailable (no NOMINATIM_USER_AGENT)', async () => {
    const { app: bare } = buildTestApp(database, { testRoutes: true, nominatim: false });
    const res = await bare.inject({
      method: 'GET',
      url: '/api/geocode',
      query: { q: 'Leeds' },
      cookies: await signIn(bare),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'geocode_unavailable' });
    await bare.close();
  });
});

/** A point (4 dp) no other test run has cached, plus `extra` digits below the cache's rounding. */
function uniquePoint(extra = '') {
  const lat = (Math.floor(Math.random() * 1_600_000) / 10_000 - 80).toFixed(4);
  const lng = (Math.floor(Math.random() * 3_400_000) / 10_000 - 170).toFixed(4);
  cachedQueries.push(reverseCacheKey(Number(lat), Number(lng)));
  return { lat: `${lat}${extra}`, lng: `${lng}${extra}` };
}

const reverse = (query: Record<string, string>, cookies?: Record<string, string>, target = app) =>
  target.inject({ method: 'GET', url: '/api/geocode/reverse', query, cookies });

const headingleyPlace = {
  lat: '53.8189',
  lon: '-1.5806',
  display_name: 'Headingley, Leeds, West Yorkshire, England, United Kingdom',
};
const headingley = {
  label: 'Headingley, Leeds, West Yorkshire, England, United Kingdom',
  lat: 53.8189,
  lng: -1.5806,
};

describe('GET /api/geocode/reverse', () => {
  it('is 401 when signed out, without calling Nominatim', async () => {
    const res = await reverse(uniquePoint());
    expect(res.statusCode).toBe(401);
    expect(nominatimFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing lat', { lng: '0' }],
    ['a missing lng', { lat: '0' }],
    ['a non-numeric lat', { lat: 'north', lng: '0' }],
    ['a non-numeric lng', { lat: '0', lng: '1e' }],
    ['a lat above 90', { lat: '90.1', lng: '0' }],
    ['a lat below -90', { lat: '-90.1', lng: '0' }],
    ['a lng above 180', { lat: '0', lng: '180.1' }],
    ['a lng below -180', { lat: '0', lng: '-180.1' }],
  ])('rejects %s with 400', async (_name, query) => {
    const res = await reverse(query, await signIn());
    expect(res.statusCode).toBe(400);
    expect(nominatimFetch).not.toHaveBeenCalled();
  });

  it('returns the place, asking Nominatim at street level with coordinates rounded to 4 dp', async () => {
    nominatimFetch.mockResolvedValue(Response.json(headingleyPlace));
    const point = uniquePoint('2');
    const res = await reverse(point, await signIn());
    expect(res.statusCode).toBe(200);
    expect(res.json<ReverseGeocodeResponse>()).toEqual({ result: headingley });

    expect(nominatimFetch).toHaveBeenCalledOnce();
    const [url, init] = nominatimFetch.mock.calls[0]!;
    const sent = new URL(String(url));
    expect(`${sent.origin}${sent.pathname}`).toBe(NOMINATIM_REVERSE_URL);
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      lat: String(Number(point.lat.slice(0, -1))),
      lon: String(Number(point.lng.slice(0, -1))),
      zoom: '16',
      format: 'jsonv2',
    });
    expect(new Headers(init?.headers).get('User-Agent')).toBe('myKOM-tests');
  });

  it('is { result: null } for "Unable to geocode", and caches that null', async () => {
    const cookies = await signIn();
    const point = uniquePoint();
    nominatimFetch.mockResolvedValue(Response.json({ error: 'Unable to geocode' }));
    const res = await reverse(point, cookies);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: null });

    const repeat = await reverse(point, cookies);
    expect(repeat.json()).toEqual({ result: null });
    expect(nominatimFetch).toHaveBeenCalledOnce();
  });

  it('serves a repeat, or a point differing only in the 5th decimal, from geocode_cache', async () => {
    const cookies = await signIn();
    const point = uniquePoint();
    nominatimFetch.mockResolvedValue(Response.json(headingleyPlace));
    await reverse(point, cookies);
    expect(nominatimFetch).toHaveBeenCalledOnce();

    const [row] = await db
      .select()
      .from(geocodeCache)
      .where(eq(geocodeCache.query, reverseCacheKey(Number(point.lat), Number(point.lng))));
    expect(row?.results).toEqual([headingley]);

    expect((await reverse(point, cookies)).json()).toEqual({ result: headingley });
    const nudged = { lat: `${point.lat}3`, lng: `${point.lng}4` };
    expect((await reverse(nudged, cookies)).json()).toEqual({ result: headingley });
    expect(nominatimFetch).toHaveBeenCalledOnce();
  });

  it("doesn't let a search for the key's text read the reverse entry", async () => {
    const cookies = await signIn();
    cachedQueries.push(reverseCacheKey(1, 2), 'reverse:1,2');
    nominatimFetch.mockResolvedValue(Response.json(headingleyPlace));
    expect((await reverse({ lat: '1', lng: '2' }, cookies)).json()).toEqual({ result: headingley });

    nominatimFetch.mockReset();
    nominatimFetch.mockResolvedValue(Response.json([]));
    const res = await geocode('reverse:1,2', cookies);
    expect(res.json()).toEqual({ results: [] });
    expect(nominatimFetch).toHaveBeenCalledOnce();
  });

  it('is 502 when Nominatim fails, and caches nothing', async () => {
    const cookies = await signIn();
    const point = uniquePoint();
    nominatimFetch.mockResolvedValue(new Response('oops', { status: 500 }));
    const res = await reverse(point, cookies);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'geocode_failed' });
    const rows = await db
      .select()
      .from(geocodeCache)
      .where(eq(geocodeCache.query, reverseCacheKey(Number(point.lat), Number(point.lng))));
    expect(rows).toEqual([]);
  });

  it('is 503 without a Nominatim client', async () => {
    const { app: bare } = buildTestApp(database, { testRoutes: true, nominatim: false });
    const res = await reverse(uniquePoint(), await signIn(bare), bare);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'geocode_unavailable' });
    await bare.close();
  });
});
