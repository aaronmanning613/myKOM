import { MAX_GEOCODE_QUERY_LENGTH, type GeocodeResponse } from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { geocodeCache, runners } from '../db/schema.js';
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
