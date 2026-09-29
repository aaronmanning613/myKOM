import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { ensureDatabase } from './ensure-database.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// A throwaway database, so the migration runs against foundation data rather than the
// already-migrated test database.
const url = new URL(inject('testDatabaseUrl'));
url.pathname = `/mykom_migration_${process.pid}_${Date.now()}`;

let database: Database;
let foundationFolder: string;

/** A copy of the migrations folder with only the migrations before 0006 in its journal. */
async function foundationMigrations(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'mykom-foundation-'));
  await cp(migrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number }[];
  };
  journal.entries = journal.entries.filter((e) => e.idx < 6);
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

beforeAll(async () => {
  await ensureDatabase(url.toString());
  database = createDatabase(url.toString());
  foundationFolder = await foundationMigrations();
});

afterAll(async () => {
  await database.close();
  await rm(foundationFolder, { recursive: true, force: true });
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${url.pathname.slice(1)}"`);
  await admin.end();
});

describe('migration 0006_core_schema', () => {
  it('applies to a database with foundation data and migrates Benchmark sources', async () => {
    const { db } = database;
    await migrate(db, { migrationsFolder: foundationFolder });
    await db.execute(sql`
      insert into runners (strava_athlete_id, first_name, sex) values (123, 'Paula', 'F')`);
    await db.execute(sql`
      insert into strava_tokens (runner_id, access_token, refresh_token, expires_at, granted_scopes)
      select id, 'v1:a', 'v1:r', now(), '{read}' from runners`);
    await db.execute(sql`
      insert into benchmarks (runner_id, distance, seconds, source)
      select id, '5k', 1200, 'strava'::benchmark_source from runners
      union all select id, '10k', 2500, 'runner'::benchmark_source from runners`);
    await db.execute(sql`
      insert into search_areas (runner_id, label, lat, lng, radius_km)
      select id, 'Ottawa', 45.4, -75.7, 5 from runners`);

    await migrate(db, { migrationsFolder });

    const benchmarks = await db.execute<{
      distance: string;
      seconds: number;
      source: string;
      generated_seconds: number | null;
    }>(sql`select distance, seconds, source, generated_seconds from benchmarks order by distance`);
    expect([...benchmarks]).toEqual([
      { distance: '10k', seconds: 2500, source: 'runner', generated_seconds: null },
      { distance: '5k', seconds: 1200, source: 'generated', generated_seconds: null },
    ]);
    const [runner] = await db.execute<Record<string, unknown>>(sql`select * from runners`);
    expect(runner).toMatchObject({
      first_name: 'Paula',
      record_gender: null,
      onboarded_at: null,
      activities_checked_at: null,
      resynced_at: null,
    });
    const [area] = await db.execute(sql`select label from search_areas`);
    expect(area).toEqual({ label: 'Ottawa' });
    const [tokens] = await db.execute(sql`select access_token from strava_tokens`);
    expect(tokens).toEqual({ access_token: 'v1:a' });
    await expect(db.execute(sql`select 'strava'::benchmark_source`)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('invalid input value for enum') },
    });
  });
});
