import { loadRootEnvFile, readEnv } from '../env.js';
import { createDatabase } from './client.js';
import { runMigrations } from './migrations.js';

loadRootEnvFile();
const { databaseUrl } = readEnv();
const database = createDatabase(databaseUrl);

try {
  await runMigrations(database.db);
  console.log('Migrations applied.');
} finally {
  await database.close();
}
