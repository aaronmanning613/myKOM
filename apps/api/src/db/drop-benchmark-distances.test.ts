import { readFile } from 'node:fs/promises';
import type { BenchmarkDistanceId } from '@mykom/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../test/app.js';
import { benchmarks, runners } from './schema.js';

const database = useTestDatabase();
const { db } = database;
const runnerIds: number[] = [];

afterAll(async () => {
  for (const id of runnerIds) await db.delete(runners).where(eq(runners.id, id));
});

describe('migration 0005_drop_benchmark_distances', () => {
  it('deletes stored 1/2 mile and 2 mile Benchmarks and keeps the rest', async () => {
    const stravaId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const [runner] = await db
      .insert(runners)
      .values({ stravaAthleteId: stravaId, firstName: 'Migrating' })
      .returning({ id: runners.id });
    runnerIds.push(runner!.id);
    await db.insert(benchmarks).values([
      {
        runnerId: runner!.id,
        distance: 'half-mile' as BenchmarkDistanceId,
        seconds: 150,
        source: 'runner',
      },
      {
        runnerId: runner!.id,
        distance: '2-mile' as BenchmarkDistanceId,
        seconds: 660,
        source: 'runner',
      },
      { runnerId: runner!.id, distance: '5k', seconds: 1200, source: 'runner' },
    ]);

    const migration = await readFile(
      new URL('../../drizzle/0005_drop_benchmark_distances.sql', import.meta.url),
      'utf8',
    );
    await db.execute(sql.raw(migration));

    const rows = await db.select().from(benchmarks).where(eq(benchmarks.runnerId, runner!.id));
    expect(rows.map((r) => r.distance)).toEqual(['5k']);
  });
});
