import { loadRootEnvFile, readEnv, usesDevTokenEncryptionKey } from '../env.js';
import { createTokenCipher } from '../strava/token-cipher.js';
import { createDatabase } from './client.js';
import { ensureDatabase } from './ensure-database.js';
import { runMigrations } from './migrations.js';

loadRootEnvFile();
const env = readEnv();
// `--create-database` creates it first if missing (the live e2e run uses its own database).
if (process.argv.includes('--create-database')) await ensureDatabase(env.databaseUrl);
if (usesDevTokenEncryptionKey(env)) {
  console.warn('TOKEN_ENCRYPTION_KEY is not set, so Strava tokens use the development key');
}
const database = createDatabase(env.databaseUrl);

try {
  await runMigrations(database.db, createTokenCipher(env.tokenEncryptionKey));
  console.log('Migrations applied.');
} finally {
  await database.close();
}
