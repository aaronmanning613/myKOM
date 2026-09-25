// Vitest global setup: creates and migrates a separate test database, so tests never touch
// the development data. Postgres must be running (`docker compose up -d --wait`).
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrations.js';
import { loadRootEnvFile, readEnv } from '../env.js';

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
  const name = new URL(url).pathname.slice(1);

  // Connect to the server's default database to create the test one if needed.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { connect_timeout: 3, onnotice: () => {} });
  try {
    const [existing] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!existing) await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  } catch (error) {
    throw new Error(
      `Couldn't prepare the test database. Is Postgres running (docker compose up -d --wait)?`,
      { cause: error },
    );
  } finally {
    await admin.end();
  }

  const database = createDatabase(url);
  try {
    await runMigrations(database.db);
  } finally {
    await database.close();
  }
  project.provide('testDatabaseUrl', url);
}
