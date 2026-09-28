import type { PlaywrightTestConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * The API and web servers for an e2e run, on their own ports so they don't collide with
 * `pnpm dev` (3001/5173). Both get `env`; existing env vars win over the repo-root .env.
 */
export function e2eServers({
  apiPort,
  webPort,
  env,
  migrateArgs = '',
}: {
  apiPort: number;
  webPort: number;
  env: Record<string, string>;
  /** Extra arguments for the migration run before the API starts. */
  migrateArgs?: string;
}): { baseURL: string; webServer: PlaywrightTestConfig['webServer'] } {
  const baseURL = `http://127.0.0.1:${webPort}`;
  const serverEnv = { API_HOST: '127.0.0.1', API_PORT: String(apiPort), ...env };
  return {
    baseURL,
    // Binaries run directly rather than through `pnpm exec`: pnpm's wrapper doesn't pass on
    // Playwright's shutdown signal, which left the run hanging after the tests finished.
    webServer: [
      {
        // Postgres must already be running (`docker compose up -d --wait`).
        command: `node_modules/.bin/tsx src/db/migrate.ts ${migrateArgs} && exec node_modules/.bin/tsx src/server.ts`,
        cwd: `${repoRoot}/apps/api`,
        env: serverEnv,
        url: `http://127.0.0.1:${apiPort}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
      {
        command: `exec node_modules/.bin/vite --host 127.0.0.1 --port ${webPort} --strictPort`,
        cwd: `${repoRoot}/apps/web`,
        env: serverEnv,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
      },
    ],
  };
}
