import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

export type Env = {
  host: string;
  port: number;
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
  };
}
