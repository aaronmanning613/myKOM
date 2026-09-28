import { defineConfig, devices } from '@playwright/test';
import { e2eServers } from './servers';

// E2E=1 turns on test mode: test-only routes such as the sign-in helper, and a stubbed Strava.
const { baseURL, webServer } = e2eServers({
  apiPort: 3101,
  webPort: 5174,
  env: { NODE_ENV: 'test', E2E: '1' },
});

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
  webServer,
});
