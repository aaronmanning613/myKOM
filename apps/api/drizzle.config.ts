import { defineConfig } from 'drizzle-kit';

// Used by `pnpm db:generate` only. Migrations are applied by src/db/migrate.ts,
// which reads DATABASE_URL from the repo-root .env.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
