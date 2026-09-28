import * as nodeFs from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRAVA_TOKEN_URL, createStravaClient } from './client.js';
import { LIVE_TOKEN_PATH, createLiveTokenStore, type LiveTokenFs } from './live-token-store.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const nowSeconds = NOW.getTime() / 1000;

// Distinctive values, so a leak into an error message is easy to spot.
const ENV_ACCESS = 'env-access-SECRET-a1';
const ENV_REFRESH = 'env-refresh-SECRET-r1';
const FILE_ACCESS = 'file-access-SECRET-a2';
const FILE_REFRESH = 'file-refresh-SECRET-r2';
const NEW_ACCESS = 'new-access-SECRET-a3';
const NEW_REFRESH = 'new-refresh-SECRET-r3';
const SECRETS = [ENV_ACCESS, ENV_REFRESH, FILE_ACCESS, FILE_REFRESH, NEW_ACCESS, NEW_REFRESH];

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mykom-live-token-'));
  path = join(dir, '.strava-live-token.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const env = (expiresAt: number) => ({
  STRAVA_ACCESS_TOKEN: ENV_ACCESS,
  STRAVA_REFRESH_TOKEN: ENV_REFRESH,
  STRAVA_TOKEN_EXPIRES_AT: String(expiresAt),
});

async function writeTokenFile(data: unknown) {
  await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data));
}

async function readTokenFile() {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function liveClient(store: ReturnType<typeof createLiveTokenStore>) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createStravaClient({
    clientId: '123',
    clientSecret: 'shh',
    tokenStore: store,
    fetch,
    now: () => NOW,
  });
  return { client, fetch };
}

/** Runs `action`, expecting it to throw, and returns the error's message. */
async function errorMessage(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return String((error as Error).message) + String((error as Error).stack);
  }
  throw new Error('expected an error');
}

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe('live token store', () => {
  it('lives in the git-ignored file at the repo root', async () => {
    expect(LIVE_TOKEN_PATH.endsWith('/.strava-live-token.json')).toBe(true);
    const gitignore = await readFile(join(LIVE_TOKEN_PATH, '../.gitignore'), 'utf8');
    expect(gitignore.split('\n')).toContain('.strava-live-token.json');
  });

  it('has no token without a file or STRAVA_REFRESH_TOKEN', async () => {
    const store = createLiveTokenStore({ path, env: { STRAVA_ACCESS_TOKEN: ENV_ACCESS } });
    expect(await store.read()).toBeUndefined();
    expect(await store.load(1)).toBeUndefined();
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('seeds the file from .env the first time', async () => {
    const store = createLiveTokenStore({ path, env: env(nowSeconds + 3600) });
    expect(await store.load(1)).toEqual({
      accessToken: ENV_ACCESS,
      refreshToken: ENV_REFRESH,
      expiresAt: new Date((nowSeconds + 3600) * 1000),
    });
    expect(await readTokenFile()).toEqual({
      accessToken: ENV_ACCESS,
      refreshToken: ENV_REFRESH,
      expiresAt: nowSeconds + 3600,
    });
    // Only the owner can read it.
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('accepts an ISO expiry in .env', async () => {
    const store = createLiveTokenStore({
      path,
      env: { ...env(0), STRAVA_TOKEN_EXPIRES_AT: '2026-09-28T13:00:00Z' },
    });
    expect((await store.read())?.expiresAt).toEqual(new Date('2026-09-28T13:00:00Z'));
  });

  it('treats a seed without an access token or a readable expiry as expired', async () => {
    for (const seed of [
      { STRAVA_REFRESH_TOKEN: ENV_REFRESH },
      { ...env(0), STRAVA_TOKEN_EXPIRES_AT: 'soon' },
      { ...env(nowSeconds + 3600), STRAVA_ACCESS_TOKEN: '' },
    ]) {
      await rm(path, { force: true });
      const token = await createLiveTokenStore({ path, env: seed }).read();
      expect(token?.refreshToken).toBe(ENV_REFRESH);
      expect(token?.expiresAt).toEqual(new Date(0));
    }
  });

  it('reads the file in preference to .env', async () => {
    await writeTokenFile({
      accessToken: FILE_ACCESS,
      refreshToken: FILE_REFRESH,
      expiresAt: nowSeconds + 7200,
      scopes: ['read', 'activity:read_all'],
    });
    const store = createLiveTokenStore({ path, env: env(nowSeconds + 3600) });
    expect(await store.read()).toEqual({
      accessToken: FILE_ACCESS,
      refreshToken: FILE_REFRESH,
      expiresAt: new Date((nowSeconds + 7200) * 1000),
      scopes: ['read', 'activity:read_all'],
    });
    const { client, fetch } = liveClient(store);
    expect(await client.getValidAccessToken(1)).toBe(FILE_ACCESS);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token through the Strava client and persists the rotated refresh token', async () => {
    await writeTokenFile({
      accessToken: FILE_ACCESS,
      refreshToken: FILE_REFRESH,
      expiresAt: nowSeconds + 60,
      scopes: ['read', 'read_all'],
    });
    const store = createLiveTokenStore({ path, env: env(nowSeconds + 3600) });
    const { client, fetch } = liveClient(store);
    fetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: NEW_ACCESS,
        refresh_token: NEW_REFRESH,
        expires_at: nowSeconds + 21600,
      }),
    );

    expect(await client.getValidAccessToken(1)).toBe(NEW_ACCESS);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(STRAVA_TOKEN_URL);
    expect(Object.fromEntries(init?.body as URLSearchParams)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: FILE_REFRESH,
    });
    // The rotated token replaced the old one on disk, and the granted scopes were kept.
    expect(await readTokenFile()).toEqual({
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: nowSeconds + 21600,
      scopes: ['read', 'read_all'],
    });
    // A new store (the next run) picks up the rotated token, not the stale one in .env.
    const next = liveClient(createLiveTokenStore({ path, env: env(nowSeconds + 3600) }));
    expect(await next.client.getValidAccessToken(1)).toBe(NEW_ACCESS);
    expect(next.fetch).not.toHaveBeenCalled();
  });

  it('seeds from .env and refreshes on first use when the .env token has expired', async () => {
    const store = createLiveTokenStore({ path, env: env(nowSeconds - 10) });
    const { client, fetch } = liveClient(store);
    fetch.mockResolvedValueOnce(
      jsonResponse({
        access_token: NEW_ACCESS,
        refresh_token: NEW_REFRESH,
        expires_at: nowSeconds + 21600,
      }),
    );
    expect(await client.getValidAccessToken(1)).toBe(NEW_ACCESS);
    expect(Object.fromEntries(fetch.mock.calls[0]![1]?.body as URLSearchParams)).toMatchObject({
      refresh_token: ENV_REFRESH,
    });
    expect(await readTokenFile()).toMatchObject({ refreshToken: NEW_REFRESH });
  });

  it('write replaces the whole token, scopes included', async () => {
    await writeTokenFile({
      accessToken: FILE_ACCESS,
      refreshToken: FILE_REFRESH,
      expiresAt: nowSeconds,
      scopes: ['read'],
    });
    const store = createLiveTokenStore({ path, env: {} });
    await store.write({
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: new Date((nowSeconds + 100) * 1000),
      scopes: ['read', 'read_all', 'activity:read_all', 'profile:read_all'],
    });
    expect(await readTokenFile()).toEqual({
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: nowSeconds + 100,
      scopes: ['read', 'read_all', 'activity:read_all', 'profile:read_all'],
    });
  });

  describe('atomic write', () => {
    it('writes a temp file in the same directory, then renames it over the token file', async () => {
      const calls: string[] = [];
      const fs: LiveTokenFs = {
        ...nodeFs,
        writeFile: (async (...args: Parameters<typeof nodeFs.writeFile>) => {
          calls.push(`write ${String(args[0])}`);
          return nodeFs.writeFile(...args);
        }) as LiveTokenFs['writeFile'],
        rename: async (from, to) => {
          calls.push(`rename ${String(from)} -> ${String(to)}`);
          return nodeFs.rename(from, to);
        },
      };
      const store = createLiveTokenStore({ path, env: {}, fs });
      await store.save(1, {
        accessToken: NEW_ACCESS,
        refreshToken: NEW_REFRESH,
        expiresAt: NOW,
      });

      expect(calls).toHaveLength(2);
      const tempPath = calls[0]!.slice('write '.length);
      expect(tempPath).not.toBe(path);
      expect(tempPath.startsWith(`${dir}/`)).toBe(true);
      expect(calls[1]).toBe(`rename ${tempPath} -> ${path}`);
      expect(await readdir(dir)).toEqual(['.strava-live-token.json']);
    });

    it('leaves the old file intact, removes the temp file and names no token when the rename fails', async () => {
      await writeTokenFile({
        accessToken: FILE_ACCESS,
        refreshToken: FILE_REFRESH,
        expiresAt: nowSeconds,
      });
      const before = await readFile(path, 'utf8');
      const fs: LiveTokenFs = {
        ...nodeFs,
        rename: async () => {
          throw new Error(`EXDEV: cross-device link ${NEW_REFRESH}`);
        },
      };
      const store = createLiveTokenStore({ path, env: {}, fs });

      const message = await errorMessage(() =>
        store.save(1, { accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, expiresAt: NOW }),
      );

      expect(message).toContain("Couldn't save .strava-live-token.json");
      expectNoSecrets(message);
      expect(await readFile(path, 'utf8')).toBe(before);
      expect(await readdir(dir)).toEqual(['.strava-live-token.json']);
    });
  });

  describe('no token in any thrown error message', () => {
    it('when the token file is not valid JSON', async () => {
      await writeTokenFile(`{"accessToken":"${FILE_ACCESS}","refreshToken":"${FILE_REFRESH}"`);
      const message = await errorMessage(() => createLiveTokenStore({ path, env: env(0) }).read());
      expect(message).toContain("isn't a valid live token file");
      expectNoSecrets(message);
    });

    it('when the token file has the wrong shape', async () => {
      for (const data of [
        { accessToken: FILE_ACCESS, refreshToken: FILE_REFRESH },
        { accessToken: FILE_ACCESS, refreshToken: FILE_REFRESH, expiresAt: 'soon' },
        { accessToken: FILE_ACCESS, refreshToken: '', expiresAt: 1 },
        { accessToken: FILE_ACCESS, refreshToken: FILE_REFRESH, expiresAt: 1, scopes: 'read' },
        [FILE_ACCESS, FILE_REFRESH],
      ]) {
        await writeTokenFile(data);
        const message = await errorMessage(() =>
          createLiveTokenStore({ path, env: env(0) }).read(),
        );
        expect(message).toContain("isn't a valid live token file");
        expectNoSecrets(message);
      }
    });

    it('when the token file cannot be read', async () => {
      const fs: LiveTokenFs = {
        ...nodeFs,
        readFile: (async () => {
          throw Object.assign(new Error(`EACCES ${FILE_REFRESH}`), { code: 'EACCES' });
        }) as LiveTokenFs['readFile'],
      };
      const message = await errorMessage(() =>
        createLiveTokenStore({ path, env: env(0), fs }).read(),
      );
      expect(message).toContain("Couldn't read .strava-live-token.json");
      expectNoSecrets(message);
    });

    it('when Strava rejects the refresh', async () => {
      await writeTokenFile({
        accessToken: FILE_ACCESS,
        refreshToken: FILE_REFRESH,
        expiresAt: nowSeconds,
      });
      const { client, fetch } = liveClient(createLiveTokenStore({ path, env: {} }));
      fetch.mockResolvedValueOnce(
        jsonResponse({ message: 'Bad Request', errors: [{ field: 'refresh_token' }] }, 400),
      );
      const message = await errorMessage(() => client.getValidAccessToken(1));
      expect(message).toContain('Strava responded 400');
      expectNoSecrets(message);
      // The old token stays on file.
      expect(await readTokenFile()).toMatchObject({ refreshToken: FILE_REFRESH });
    });

    it('when Strava sends a malformed refresh response', async () => {
      await writeTokenFile({
        accessToken: FILE_ACCESS,
        refreshToken: FILE_REFRESH,
        expiresAt: nowSeconds,
      });
      const { client, fetch } = liveClient(createLiveTokenStore({ path, env: {} }));
      fetch.mockResolvedValueOnce(jsonResponse({ access_token: NEW_ACCESS }));
      const message = await errorMessage(() => client.getValidAccessToken(1));
      expectNoSecrets(message);
    });

    it('when the network fails', async () => {
      await writeTokenFile({
        accessToken: FILE_ACCESS,
        refreshToken: FILE_REFRESH,
        expiresAt: nowSeconds,
      });
      const { client, fetch } = liveClient(createLiveTokenStore({ path, env: {} }));
      fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      const message = await errorMessage(() => client.getValidAccessToken(1));
      expect(message).toContain('fetch failed');
      expectNoSecrets(message);
    });
  });
});
