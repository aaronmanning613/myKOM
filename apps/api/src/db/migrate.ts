import { loadRootEnvFile, readEnv } from '../env.js';
import { createDatabase } from './client.js';
import { ensureDatabase } from './ensure-database.js';
import { runMigrations } from './migrations.js';

loadRootEnvFile();
const { databaseUrl } = readEnv();
// `--create-database` creates it first if missing (the live e2e run uses its own database).
if (process.argv.includes('--create-database')) await ensureDatabase(databaseUrl);
const database = createDatabase(databaseUrl);

try {
  await runMigrations(database.db);
  console.log('Migrations applied.');
} finally {
  await database.close();
}
