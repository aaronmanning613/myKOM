import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, useTestDatabase } from '../test/app.js';

const INDEX_HTML = '<!doctype html><title>myKOM</title><div id="root"></div>';

describe('serving the web app', () => {
  const database = useTestDatabase();
  let webRoot: string;

  beforeAll(() => {
    webRoot = mkdtempSync(join(tmpdir(), 'mykom-web-'));
    mkdirSync(join(webRoot, 'assets'));
    writeFileSync(join(webRoot, 'index.html'), INDEX_HTML);
    writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log("myKOM")');
  });
  afterAll(() => rmSync(webRoot, { recursive: true, force: true }));

  it.each(['/', '/results', '/fitness-profile?x=1', '/welcome'])(
    'serves index.html at %s',
    async (url) => {
      const { app } = buildTestApp(database, { webRoot });
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toBe(INDEX_HTML);
      await app.close();
    },
  );

  it('serves hashed assets as immutable', async () => {
    const { app } = buildTestApp(database, { webRoot });
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    await app.close();
  });

  it('still answers the API', async () => {
    const { app } = buildTestApp(database, { webRoot });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ ok: true, db: 'up' });
    await app.close();
  });

  it.each([
    ['GET', '/api/nope'],
    ['GET', '/api'],
    ['GET', '/internal/nope'],
    ['POST', '/internal/tick'],
    ['POST', '/results'],
  ] as const)('keeps %s %s a 404', async (method, url) => {
    const { app } = buildTestApp(database, { webRoot });
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Not Found', statusCode: 404 });
    await app.close();
  });

  it('serves nothing but the API without a web root', async () => {
    const { app } = buildTestApp(database);
    const res = await app.inject({ method: 'GET', url: '/results' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
