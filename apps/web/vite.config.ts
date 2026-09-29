import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Read the API's address from the repo-root .env so the proxy follows it.
  const env = loadEnv(mode, repoRoot, 'API_');
  const apiTarget = `http://${env.API_HOST ?? '127.0.0.1'}:${env.API_PORT ?? '3001'}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        // Keep the browser's Host header (the string shorthand would set changeOrigin: true), so
        // the API builds the Strava callback URL on the web app's origin, where the OAuth state
        // cookie was set, rather than on the API's own address.
        '/api': { target: apiTarget, changeOrigin: false },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
