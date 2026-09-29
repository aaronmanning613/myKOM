import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Live tests hit the real Strava API; they run only through `pnpm test:live`.
    exclude: [...configDefaults.exclude, '**/*.live.test.ts'],
  },
});
