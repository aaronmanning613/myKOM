// `pnpm test:e2e:live`: the opt-in e2e tests signed in as the real Strava Runner, never part of
// `pnpm test:e2e`. The servers run in live mode (E2E_LIVE=1): Strava is real, using the live
// token file, and deauthorize is blocked. See e2e/live/.
import { defineConfig, devices } from '@playwright/test';
import { e2eServers } from './servers';

const { baseURL, webServer } = e2eServers({
  apiPort: 3201,
  webPort: 5274,
  env: {
    E2E_LIVE: '1',
    // A database of its own, so the real Runner's e2e data never mixes with development data.
    DATABASE_URL:
      process.env.E2E_LIVE_DATABASE_URL ?? 'postgres://mykom:mykom@localhost:5433/mykom_e2e_live',
  },
  migrateArgs: '--create-database',
});

export default defineConfig({
  testDir: './live',
  // One token file and a shared Strava rate limit: one test at a time, and no retries.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The first sign-in on a fresh database reads the whole activity list (see sign-in-live.ts).
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL,
    // No traces: they record request and response bodies.
    trace: 'off',
  },
  projects: [
    {
      name: 'chrome-live',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer,
});
