import type { SearchAreaResponse } from '@mykom/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { runners, searchAreas } from '../db/schema.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';

const database = useTestDatabase();
const { db } = database;
const { app } = buildTestApp(database, { testRoutes: true });
const runnerIds: number[] = [];

afterAll(async () => {
  await app.close();
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
});

/** Signs in a new Runner and returns their id and session cookie. */
async function signIn() {
  const res = await app.inject({ method: 'POST', url: '/api/test/login' });
  const { id } = res.json<{ id: number }>();
  runnerIds.push(id);
  const session = res.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { id, cookies: { [SESSION_COOKIE]: session } };
}

type Session = Awaited<ReturnType<typeof signIn>>;

const getSearchArea = (session?: Session) =>
  app.inject({ method: 'GET', url: '/api/search-area', cookies: session?.cookies });

const putSearchArea = (session: Session | undefined, payload: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/api/search-area',
    cookies: session?.cookies,
    payload: payload as object,
  });

const leeds = { label: 'Leeds, West Yorkshire', lat: 53.7974185, lng: -1.5437941, radiusKm: 10 };
const york = { label: 'York', lat: 53.9590555, lng: -1.0815361, radiusKm: 25 };

describe('GET /api/search-area', () => {
  it('is 401 when signed out', async () => {
    expect((await getSearchArea()).statusCode).toBe(401);
  });

  it('is null for a new Runner', async () => {
    const res = await getSearchArea(await signIn());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ searchArea: null });
  });

  it('is null when the saved radius is no longer offered', async () => {
    const session = await signIn();
    await db.insert(searchAreas).values({ runnerId: session.id, ...leeds, radiusKm: 7 as 5 });
    expect((await getSearchArea(session)).json()).toEqual({ searchArea: null });
  });
});

describe('PUT /api/search-area', () => {
  it('is 401 when signed out', async () => {
    expect((await putSearchArea(undefined, leeds)).statusCode).toBe(401);
  });

  it('saves the Search Area and returns it', async () => {
    const session = await signIn();
    const res = await putSearchArea(session, leeds);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ searchArea: leeds });
    expect((await getSearchArea(session)).json()).toEqual({ searchArea: leeds });
  });

  it('replaces the previous one, keeping one row per Runner', async () => {
    const session = await signIn();
    await putSearchArea(session, leeds);
    const res = await putSearchArea(session, york);
    expect(res.json()).toEqual({ searchArea: york });
    const rows = await db.select().from(searchAreas).where(eq(searchAreas.runnerId, session.id));
    expect(rows).toHaveLength(1);
  });

  it('trims the label', async () => {
    const session = await signIn();
    const res = await putSearchArea(session, { ...leeds, label: '  LS1 4DY ' });
    expect(res.json<SearchAreaResponse>().searchArea?.label).toBe('LS1 4DY');
  });

  it.each([5, 10, 25, 50])('accepts a %i km radius', async (radiusKm) => {
    const res = await putSearchArea(await signIn(), { ...leeds, radiusKm });
    expect(res.json<SearchAreaResponse>().searchArea?.radiusKm).toBe(radiusKm);
  });

  it.each([
    ['a radius not offered', { ...leeds, radiusKm: 7 }],
    ['a zero radius', { ...leeds, radiusKm: 0 }],
    ['a fractional radius', { ...leeds, radiusKm: 10.5 }],
    ['a missing radius', { label: leeds.label, lat: leeds.lat, lng: leeds.lng }],
    ['a blank label', { ...leeds, label: '   ' }],
    ['a label that is too long', { ...leeds, label: 'x'.repeat(301) }],
    ['a latitude out of range', { ...leeds, lat: 90.1 }],
    ['a longitude out of range', { ...leeds, lng: -180.1 }],
    ['a missing latitude', { label: leeds.label, lng: leeds.lng, radiusKm: 10 }],
  ])('rejects %s with 400 and saves nothing', async (_name, payload) => {
    const session = await signIn();
    await putSearchArea(session, york);
    const res = await putSearchArea(session, payload);
    expect(res.statusCode).toBe(400);
    expect((await getSearchArea(session)).json()).toEqual({ searchArea: york });
  });
});

describe("one Runner and another's Search Area", () => {
  let alice: Session;
  let bob: Session;

  beforeAll(async () => {
    alice = await signIn();
    bob = await signIn();
    await putSearchArea(alice, leeds);
  });

  it("can't read or change it", async () => {
    expect((await getSearchArea(bob)).json()).toEqual({ searchArea: null });
    await putSearchArea(bob, york);
    expect((await getSearchArea(alice)).json()).toEqual({ searchArea: leeds });
  });

  it('goes when the Runner is deleted', async () => {
    await db.delete(runners).where(eq(runners.id, alice.id));
    const rows = await db.select().from(searchAreas).where(eq(searchAreas.runnerId, alice.id));
    expect(rows).toEqual([]);
  });
});
