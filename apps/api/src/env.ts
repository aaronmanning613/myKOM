import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

/** Matches the Postgres service in docker-compose.yml. */
export const DEFAULT_DATABASE_URL = 'postgres://mykom:mykom@localhost:5433/mykom';

export type Env = {
  host: string;
  port: number;
  databaseUrl: string;
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
  return {
    host: source.API_HOST ?? '127.0.0.1',
    port,
    databaseUrl: source.DATABASE_URL || DEFAULT_DATABASE_URL,
  };
}
