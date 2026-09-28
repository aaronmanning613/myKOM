// The live token store: the real Strava account's tokens for the opt-in live tests.
//
// Strava may hand back a new refresh token on every refresh, and the old one stops working, so
// the latest token set always lives in a git-ignored file at the repo root. The first time, it is
// seeded from `.env` (STRAVA_REFRESH_TOKEN, STRAVA_ACCESS_TOKEN, STRAVA_TOKEN_EXPIRES_AT).
//
// Never put a token in an error message or log line: errors here name files and variables only.

import * as nodeFs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { repoRoot } from '../env.js';
import type { StravaTokenSet, StravaTokenStore } from './client.js';

export const LIVE_TOKEN_PATH = join(repoRoot, '.strava-live-token.json');

/** The live token set, plus the scopes granted when it was authorized (when known). */
export type LiveToken = StravaTokenSet & {
  /** Scopes the Runner granted on Strava's consent screen; unknown for a token seeded from `.env`. */
  scopes?: string[];
};

/** The file operations the store uses, replaceable in tests. */
export type LiveTokenFs = Pick<typeof nodeFs, 'readFile' | 'writeFile' | 'rename' | 'rm'>;

export type LiveTokenStoreOptions = {
  path?: string;
  env?: NodeJS.ProcessEnv;
  fs?: LiveTokenFs;
};

/**
 * A StravaTokenStore for the one live account. Runner ids are ignored: whichever Runner the
 * caller asks about, the live token is the one loaded and saved.
 */
export type LiveTokenStore = StravaTokenStore & {
  /** The live token (seeding the file from `.env` if needed), or undefined when there is none. */
  read(): Promise<LiveToken | undefined>;
  /** Replaces the whole live token, scopes included (used after a fresh authorization). */
  write(token: LiveToken): Promise<void>;
};

export class LiveTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveTokenError';
  }
}

export function createLiveTokenStore({
  path = LIVE_TOKEN_PATH,
  env = process.env,
  fs = nodeFs,
}: LiveTokenStoreOptions = {}): LiveTokenStore {
  const fileName = basename(path);

  async function readFile(): Promise<LiveToken | undefined> {
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new LiveTokenError(`Couldn't read ${fileName}`);
    }
    // JSON.parse's own message quotes the input, so it is never passed on.
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    const token = parseLiveToken(data);
    if (!token) {
      throw new LiveTokenError(
        `${fileName} isn't a valid live token file: delete it and run \`pnpm strava:authorize\``,
      );
    }
    return token;
  }

  /** Writes a temp file beside the real one, then renames it over, so a crash never leaves half a file. */
  async function write(token: LiveToken): Promise<void> {
    const tempPath = join(dirname(path), `.${fileName}.${randomBytes(6).toString('hex')}.tmp`);
    const data = {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      // Epoch seconds, like Strava's expires_at.
      expiresAt: Math.floor(token.expiresAt.getTime() / 1000),
      ...(token.scopes && { scopes: token.scopes }),
    };
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tempPath, path);
    } catch {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw new LiveTokenError(`Couldn't save ${fileName}`);
    }
  }

  async function read(): Promise<LiveToken | undefined> {
    const stored = await readFile();
    if (stored) return stored;
    const seeded = tokenFromEnv(env);
    if (seeded) await write(seeded);
    return seeded;
  }

  return {
    read,
    write,
    async load() {
      const token = await read();
      return (
        token && {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
        }
      );
    },
    async save(_runnerId, tokens) {
      // A refresh doesn't change the granted scopes, so keep the ones on file.
      const current = await readFile();
      await write({ ...tokens, scopes: current?.scopes });
    },
  };
}

/** The token set from `.env`, or undefined without STRAVA_REFRESH_TOKEN. */
function tokenFromEnv(env: NodeJS.ProcessEnv): LiveToken | undefined {
  const refreshToken = env.STRAVA_REFRESH_TOKEN?.trim();
  if (!refreshToken) return undefined;
  const accessToken = env.STRAVA_ACCESS_TOKEN?.trim() ?? '';
  const expiresAt = parseExpiresAt(env.STRAVA_TOKEN_EXPIRES_AT);
  return {
    accessToken,
    refreshToken,
    // Without a usable access token or expiry, treat it as expired so the first use refreshes.
    expiresAt: accessToken && expiresAt ? expiresAt : new Date(0),
  };
}

/** Epoch seconds (as Strava sends them) or an ISO date. */
function parseExpiresAt(value: string | undefined): Date | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const date = /^\d+$/.test(trimmed) ? new Date(Number(trimmed) * 1000) : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseLiveToken(data: unknown): LiveToken | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { accessToken, refreshToken, expiresAt, scopes } = data as Record<string, unknown>;
  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    !refreshToken ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt)
  ) {
    return undefined;
  }
  if (
    scopes !== undefined &&
    (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string'))
  ) {
    return undefined;
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(expiresAt * 1000),
    ...(scopes && { scopes }),
  };
}
