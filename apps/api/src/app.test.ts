import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /api/health', () => {
  const app = buildApp();
  afterEach(() => app.close());

  it('reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
