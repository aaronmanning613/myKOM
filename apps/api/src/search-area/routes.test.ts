import { readFile } from 'node:fs/promises';
import { eq, inArray, sql } from 'drizzle-orm';
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

const leeds = {
  label: 'Leeds, West Yorkshire',
  lat: 53.7974185,
  lng: -1.5437941,
  radiusKm: 10 as const,
};
const york = { label: 'York', lat: 53.9590555, lng: -1.0815361, radiusKm: 2 as const };

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
  it('is gone: POST /api/search saves the Search Area now', async () => {
    const session = await signIn();
    expect((await putSearchArea(session, leeds)).statusCode).toBe(404);
    expect((await getSearchArea(session)).json()).toEqual({ searchArea: null });
  });
});

describe('migration 0009_search_radii', () => {
  it('keeps a 25 or 50 km Search Area at 10 km, and leaves the rest', async () => {
    const [wide, wider, small] = [await signIn(), await signIn(), await signIn()];
    await db.insert(searchAreas).values([
      { runnerId: wide.id, ...york, radiusKm: 25 as 10 },
      { runnerId: wider.id, ...york, radiusKm: 50 as 10 },
      { runnerId: small.id, ...leeds, radiusKm: 5 },
    ]);

    const migration = await readFile(
      new URL('../../drizzle/0009_search_radii.sql', import.meta.url),
      'utf8',
    );
    await db.execute(sql.raw(migration));

    expect((await getSearchArea(wide)).json()).toEqual({ searchArea: { ...york, radiusKm: 10 } });
    expect((await getSearchArea(wider)).json()).toEqual({ searchArea: { ...york, radiusKm: 10 } });
    expect((await getSearchArea(small)).json()).toEqual({ searchArea: { ...leeds, radiusKm: 5 } });
  });
});

describe("one Runner and another's Search Area", () => {
  let alice: Session;
  let bob: Session;

  beforeAll(async () => {
    alice = await signIn();
    bob = await signIn();
    await db.insert(searchAreas).values({ runnerId: alice.id, ...leeds });
  });

  it("can't read it", async () => {
    expect((await getSearchArea(bob)).json()).toEqual({ searchArea: null });
    expect((await getSearchArea(alice)).json()).toEqual({ searchArea: leeds });
  });

  it('goes when the Runner is deleted', async () => {
    await db.delete(runners).where(eq(runners.id, alice.id));
    const rows = await db.select().from(searchAreas).where(eq(searchAreas.runnerId, alice.id));
    expect(rows).toEqual([]);
  });
});
