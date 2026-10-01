// Vitest global setup: creates and migrates a separate test database, so tests never touch
// the development data. Postgres must be running (`docker compose up -d --wait`).
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../db/client.js';
import { ensureDatabase } from '../db/ensure-database.js';
import { runMigrations } from '../db/migrations.js';
import { DEV_TOKEN_ENCRYPTION_KEY, loadRootEnvFile, readEnv } from '../env.js';
import { createTokenCipher } from '../strava/token-cipher.js';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/** TEST_DATABASE_URL, or DATABASE_URL pointed at a `mykom_test` database. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(readEnv().databaseUrl);
  url.pathname = '/mykom_test';
  return url.toString();
}

export default async function setup(project: TestProject) {
  loadRootEnvFile();
  const url = testDatabaseUrl();
  await ensureDatabase(url);

  const database = createDatabase(url);
  try {
    await runMigrations(database.db, createTokenCipher(DEV_TOKEN_ENCRYPTION_KEY));
  } finally {
    await database.close();
  }
  project.provide('testDatabaseUrl', url);
}
