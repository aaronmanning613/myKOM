// `pnpm test:live`: the opt-in tests against the real Strava account (see live-token-store.ts).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    include: ['src/**/*.live.test.ts'],
    // One token file and a shared rate limit: run the live tests one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    // Show the athlete and rate-limit log lines even when every test passes.
    reporters: ['verbose'],
  },
});
