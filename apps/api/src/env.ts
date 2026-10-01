import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rootEnvPath = resolve(repoRoot, '.env');

/** Where `pnpm geolite2:update` puts the GeoLite2 City database unless GEOLITE2_CITY_DB says otherwise. */
export const DEFAULT_GEOLITE2_CITY_DB = 'data/geolite2/GeoLite2-City.mmdb';

/** Matches the Postgres service in docker-compose.yml. */
export const DEFAULT_DATABASE_URL = 'postgres://mykom:mykom@localhost:5433/mykom';

/** Signs cookies outside production when SESSION_SECRET isn't set. Never used in production. */
export const DEV_SESSION_SECRET = 'mykom-dev-only-session-secret-do-not-use-in-production';

/** Encrypts Strava tokens outside production when TOKEN_ENCRYPTION_KEY isn't set. Never used in production. */
export const DEV_TOKEN_ENCRYPTION_KEY = Buffer.from('mykom-dev-only-token-key-32bytes', 'utf8');

/**
 * Production has no fallbacks for these (SESSION_SECRET and TOKEN_ENCRYPTION_KEY are checked
 * with their formats below).
 */
const PRODUCTION_REQUIRED = ['DATABASE_URL', 'STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'] as const;

export type Env = {
  /** API_HOST; in production every interface unless set. */
  host: string;
  /** API_PORT; in production Cloud Run's PORT wins. */
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  /**
   * TOKEN_ENCRYPTION_KEY (32 bytes, base64): encrypts Strava tokens at rest. Required in
   * production; DEV_TOKEN_ENCRYPTION_KEY otherwise.
   */
  tokenEncryptionKey: Buffer;
  stravaClientId: string;
  stravaClientSecret: string;
  /** NOMINATIM_USER_AGENT: names the app and a contact. Place search is off while it's unset. */
  nominatimUserAgent: string | undefined;
  /** GEOLITE2_CITY_DB, absolute (relative values are taken from the repo root). */
  geolite2CityDbPath: string;
  /**
   * TRUST_PROXY, for Fastify's `trustProxy`: `true` (trust every proxy) or comma-separated proxy
   * addresses/CIDRs. Off by default, so `request.ip` is the socket address.
   */
  trustProxy: boolean | string[];
  /**
   * NODE_ENV=test or E2E=1, never in production: registers test-only routes and swaps Strava for
   * a local stand-in, so end-to-end tests never need real credentials or reach Strava.
   */
  testMode: boolean;
  /**
   * E2E_LIVE=1, never in production: the real-account e2e mode. Strava is real (with the live
   * token store), deauthorize is blocked, and `POST /api/test/login-live` is registered.
   */
  liveMode: boolean;
  /** NODE_ENV=production. Outside production the dev server ticks itself on an interval. */
  production: boolean;
  /**
   * TICK_OIDC_AUDIENCE (the service URL) and TICK_SERVICE_ACCOUNT (the Cloud Scheduler service
   * account's email): what `POST /internal/tick` checks the Scheduler's OIDC token against.
   * Unset, the route refuses every token.
   */
  tickOidc: { audience: string; serviceAccountEmail: string } | undefined;
};

/** Loads the repo-root `.env` into `process.env` if present. Existing variables win. */
export function loadRootEnvFile(path: string = rootEnvPath): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const production = source.NODE_ENV === 'production';
  // Cloud Run says which port to listen on in PORT, and needs every interface.
  const portVariable = production && source.PORT ? 'PORT' : 'API_PORT';
  const port = Number(source[portVariable] ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${portVariable} must be a valid port number, got "${source[portVariable]}"`);
  }
  if (production) {
    for (const name of PRODUCTION_REQUIRED) {
      if (!source[name]?.trim()) throw new Error(`${name} must be set in production`);
    }
  }
  const sessionSecret = source.SESSION_SECRET || DEV_SESSION_SECRET;
  if (source.NODE_ENV === 'production' && sessionSecret === DEV_SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  const notProduction = source.NODE_ENV !== 'production';
  const tokenEncryptionKey = parseTokenEncryptionKey(source.TOKEN_ENCRYPTION_KEY, notProduction);
  const testMode = notProduction && (source.NODE_ENV === 'test' || source.E2E === '1');
  const liveMode = notProduction && source.E2E_LIVE === '1';
  if (testMode && liveMode) {
    throw new Error('E2E_LIVE=1 can’t be combined with test mode (NODE_ENV=test or E2E=1)');
  }
  return {
    host: source.API_HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    port,
    databaseUrl: source.DATABASE_URL || DEFAULT_DATABASE_URL,
    sessionSecret,
    tokenEncryptionKey,
    stravaClientId: source.STRAVA_CLIENT_ID ?? '',
    stravaClientSecret: source.STRAVA_CLIENT_SECRET ?? '',
    nominatimUserAgent: source.NOMINATIM_USER_AGENT?.trim() || undefined,
    geolite2CityDbPath: resolve(
      repoRoot,
      source.GEOLITE2_CITY_DB?.trim() || DEFAULT_GEOLITE2_CITY_DB,
    ),
    trustProxy: parseTrustProxy(source.TRUST_PROXY),
    testMode,
    liveMode,
    production: !notProduction,
    tickOidc: parseTickOidc(source.TICK_OIDC_AUDIENCE, source.TICK_SERVICE_ACCOUNT),
  };
}

function parseTickOidc(
  audience: string | undefined,
  serviceAccountEmail: string | undefined,
): Env['tickOidc'] {
  const aud = audience?.trim() ?? '';
  const email = serviceAccountEmail?.trim() ?? '';
  if (aud === '' && email === '') return undefined;
  if (aud === '' || email === '') {
    throw new Error('TICK_OIDC_AUDIENCE and TICK_SERVICE_ACCOUNT must be set together');
  }
  return { audience: aud, serviceAccountEmail: email };
}

function parseTokenEncryptionKey(value: string | undefined, notProduction: boolean): Buffer {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    if (notProduction) return DEV_TOKEN_ENCRYPTION_KEY;
    throw new Error('TOKEN_ENCRYPTION_KEY must be set in production');
  }
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== 32 || key.toString('base64') !== trimmed) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`)',
    );
  }
  return key;
}

/** True when Strava tokens are encrypted with the development key, so the server can warn. */
export function usesDevTokenEncryptionKey(env: Pick<Env, 'tokenEncryptionKey'>): boolean {
  return env.tokenEncryptionKey.equals(DEV_TOKEN_ENCRYPTION_KEY);
}

function parseTrustProxy(value: string | undefined): Env['trustProxy'] {
  const trimmed = value?.trim().toLowerCase() ?? '';
  if (trimmed === '' || trimmed === 'false') return false;
  if (trimmed === 'true') return true;
  // Fastify ignores hop counts (it can't check the nearest peer), so they aren't offered here.
  return trimmed
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}
