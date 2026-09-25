import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

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
  /**
   * NODE_ENV=test or E2E=1, never in production: registers test-only routes and swaps Strava for
   * a local stand-in, so end-to-end tests never need real credentials or reach Strava.
   */
  testMode: boolean;
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
  return {
    host: source.API_HOST ?? '127.0.0.1',
    port,
    databaseUrl: source.DATABASE_URL || DEFAULT_DATABASE_URL,
    sessionSecret,
    stravaClientId: source.STRAVA_CLIENT_ID ?? '',
    stravaClientSecret: source.STRAVA_CLIENT_SECRET ?? '',
    nominatimUserAgent: source.NOMINATIM_USER_AGENT?.trim() || undefined,
    testMode:
      source.NODE_ENV !== 'production' && (source.NODE_ENV === 'test' || source.E2E === '1'),
  };
}
