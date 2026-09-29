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

export type Env = {
  host: string;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
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
};

/** Loads the repo-root `.env` into `process.env` if present. Existing variables win. */
export function loadRootEnvFile(path: string = rootEnvPath): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`API_PORT must be a valid port number, got "${source.API_PORT}"`);
  }
  const sessionSecret = source.SESSION_SECRET || DEV_SESSION_SECRET;
  if (source.NODE_ENV === 'production' && sessionSecret === DEV_SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  const notProduction = source.NODE_ENV !== 'production';
  const testMode = notProduction && (source.NODE_ENV === 'test' || source.E2E === '1');
  const liveMode = notProduction && source.E2E_LIVE === '1';
  if (testMode && liveMode) {
    throw new Error('E2E_LIVE=1 can’t be combined with test mode (NODE_ENV=test or E2E=1)');
  }
  return {
    host: source.API_HOST ?? '127.0.0.1',
    port,
    databaseUrl: source.DATABASE_URL || DEFAULT_DATABASE_URL,
    sessionSecret,
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
  };
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
