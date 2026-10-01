import type { IpLocation, LocateIpResponse } from '@mykom/shared';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../auth/session.js';
import { runners } from '../db/schema.js';
import { buildTestApp, useTestDatabase } from '../test/app.js';
import type { IpLocator } from './locator.js';

const database = useTestDatabase();
const { db } = database;
const runnerIds: number[] = [];

const leeds: IpLocation = {
  label: 'Leeds, England, United Kingdom',
  lat: 53.7974,
  lng: -1.5438,
  accuracyRadiusKm: 20,
};

/** A locator (standing in for a mocked GeoLite2 reader) that only knows Leeds' address. */
function leedsLocator() {
  return {
    locate: vi.fn((ip: string) => (ip === '81.2.69.160' ? leeds : null)),
  } satisfies IpLocator;
}

function testApp(options: Parameters<typeof buildTestApp>[1] = {}) {
  const { app } = buildTestApp(database, { testRoutes: true, ...options });
  afterAll(() => app.close());
  return app;
}

afterAll(async () => {
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
});

async function signIn(app: ReturnType<typeof testApp>) {
  const res = await app.inject({ method: 'POST', url: '/api/test/login' });
  runnerIds.push(res.json<{ id: number }>().id);
  return { [SESSION_COOKIE]: res.cookies.find((c) => c.name === SESSION_COOKIE)!.value };
}

describe('GET /api/locate-ip', () => {
  const locator = leedsLocator();
  const app = testApp({ ipLocator: locator });

  it('is 401 when signed out, without a lookup', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/locate-ip' });
    expect(res.statusCode).toBe(401);
    expect(locator.locate).not.toHaveBeenCalled();
  });

  it("returns the location of the client's address", async () => {
    const cookies = await signIn(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/locate-ip',
      remoteAddress: '81.2.69.160',
      cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<LocateIpResponse>()).toEqual({ available: true, location: leeds });
    expect(locator.locate).toHaveBeenCalledWith('81.2.69.160');
  });

  it('is unavailable (not_found) for an address the database does not place', async () => {
    const cookies = await signIn(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/locate-ip',
      remoteAddress: '127.0.0.1',
      cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<LocateIpResponse>()).toEqual({ available: false, reason: 'not_found' });
  });

  it('ignores X-Forwarded-For unless TRUST_PROXY trusts the proxy', async () => {
    const cookies = await signIn(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/locate-ip',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '81.2.69.160' },
      cookies,
    });
    expect(res.json<LocateIpResponse>()).toEqual({ available: false, reason: 'not_found' });
    expect(locator.locate).toHaveBeenLastCalledWith('10.0.0.1');
  });
});

describe('GET /api/locate-ip behind a trusted proxy', () => {
  const locator = leedsLocator();
  const app = testApp({ ipLocator: locator, trustProxy: ['10.0.0.1'] });

  it('uses the client address from X-Forwarded-For', async () => {
    const cookies = await signIn(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/locate-ip',
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '81.2.69.160' },
      cookies,
    });
    expect(res.json<LocateIpResponse>()).toEqual({ available: true, location: leeds });
    expect(locator.locate).toHaveBeenCalledWith('81.2.69.160');
  });
});

describe('GET /api/locate-ip without the GeoLite2 database', () => {
  const app = testApp();

  it('is unavailable (no_database)', async () => {
    const cookies = await signIn(app);
    const res = await app.inject({ method: 'GET', url: '/api/locate-ip', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json<LocateIpResponse>()).toEqual({ available: false, reason: 'no_database' });
  });
});

describe('GET /api/locate-ip with the fallback off (as in production)', () => {
  const locator = leedsLocator();
  const app = testApp({ ipLocator: locator, ipFallback: false });

  it('is unavailable (disabled), without a lookup', async () => {
    const cookies = await signIn(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/locate-ip',
      remoteAddress: '81.2.69.160',
      cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<LocateIpResponse>()).toEqual({ available: false, reason: 'disabled' });
    expect(locator.locate).not.toHaveBeenCalled();
  });
});
