import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadRootEnvFile, readEnv } from '../env.js';
import { createDatabase } from './client.js';

// Resolves to apps/api/drizzle from both src/db and dist/db.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

loadRootEnvFile();
const { databaseUrl } = readEnv();
const database = createDatabase(databaseUrl);

try {
  await migrate(database.db, { migrationsFolder });
  console.log('Migrations applied.');
} finally {
  await database.close();
}
