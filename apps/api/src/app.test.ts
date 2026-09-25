import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /api/health', () => {
  it('reports ok when the database is reachable', async () => {
    const app = buildApp({ isDatabaseReachable: async () => true });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: 'up' });
    await app.close();
  });

  it('reports the database as down with a 503', async () => {
    const app = buildApp({ isDatabaseReachable: async () => false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'down' });
    await app.close();
  });
});
