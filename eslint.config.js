import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      'playwright-report/',
      'test-results/',
      '.playwright-mcp/',
      '.agents/',
      '.claude/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Every e2e spec uses the shared fixture, which answers map tile requests with a blank tile.
    files: ['e2e/tests/**/*.ts', 'e2e/live/**/*.ts'],
    ignores: ['e2e/tests/fixtures.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message: 'Import from e2e/tests/fixtures instead, so tests never fetch map tiles.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  prettier,
);
