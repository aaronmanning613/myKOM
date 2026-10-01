import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { TokenCipher } from '../strava/token-cipher.js';
import { encryptPlainTextTokens } from '../strava/token-store.js';
import type { Database } from './client.js';

// Resolves to apps/api/drizzle from both src/db and dist/db.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Applies any pending migrations in apps/api/drizzle, then the data migrations SQL can't do:
 * encrypting plain-text Strava tokens with `tokenCipher` (the key lives outside the database).
 */
export async function runMigrations(db: Database['db'], tokenCipher: TokenCipher): Promise<void> {
  await migrate(db, { migrationsFolder });
  await encryptPlainTextTokens(db, tokenCipher);
}
