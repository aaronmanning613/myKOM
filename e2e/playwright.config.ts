import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Separate ports from `pnpm dev` (3001/5173) so e2e runs don't collide with a dev session.
const API_PORT = 3101;
const WEB_PORT = 5174;
const baseURL = `http://127.0.0.1:${WEB_PORT}`;

// Both servers read these; existing env vars win over the repo-root .env.
// E2E=1 is what later enables test-only routes such as the sign-in helper.
const serverEnv = {
  API_HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  NODE_ENV: 'test',
  E2E: '1',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  // Binaries run directly rather than through `pnpm exec`: pnpm's wrapper doesn't pass on
  // Playwright's shutdown signal, which left the run hanging after the tests finished.
  webServer: [
    {
      // Postgres must already be running (`docker compose up -d --wait`).
      command:
        'node_modules/.bin/tsx src/db/migrate.ts && exec node_modules/.bin/tsx src/server.ts',
      cwd: `${repoRoot}/apps/api`,
      env: serverEnv,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `exec node_modules/.bin/vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: `${repoRoot}/apps/web`,
      env: serverEnv,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
