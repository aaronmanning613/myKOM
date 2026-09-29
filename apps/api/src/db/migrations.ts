import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client.js';

// Resolves to apps/api/drizzle from both src/db and dist/db.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies any pending migrations in apps/api/drizzle. */
export function runMigrations(db: Database['db']): Promise<void> {
  return migrate(db, { migrationsFolder });
}
