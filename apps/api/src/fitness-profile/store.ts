import {
  BENCHMARK_DISTANCES,
  isBenchmarkDistanceId,
  type FitnessProfile,
  type FitnessProfileUpdate,
} from '@mykom/shared';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { benchmarks } from '../db/schema.js';

type Db = Database['db'];

const distanceOrder = (id: string) => BENCHMARK_DISTANCES.findIndex((d) => d.id === id);

/** The Runner's Benchmarks, in BENCHMARK_DISTANCES order. */
export async function loadFitnessProfile(db: Db, runnerId: number): Promise<FitnessProfile> {
  const rows = await db.select().from(benchmarks).where(eq(benchmarks.runnerId, runnerId));
  return {
    benchmarks: rows
      // Skips distances dropped from BENCHMARK_DISTANCES since they were saved.
      .filter((row) => isBenchmarkDistanceId(row.distance))
      .sort((a, b) => distanceOrder(a.distance) - distanceOrder(b.distance))
      .map(({ distance, seconds, source, updatedAt }) => ({
        distance,
        seconds,
        source,
        updatedAt: updatedAt.toISOString(),
      })),
  };
}

/**
 * Replaces the Runner's Benchmarks with `update`: distances left out are cleared, and
 * changed times become `source: runner`. An unchanged time keeps its source and updated_at.
 */
export async function saveFitnessProfile(
  db: Db,
  runnerId: number,
  update: FitnessProfileUpdate,
): Promise<void> {
  const distances = update.benchmarks.map((b) => b.distance);
  await db.transaction(async (tx) => {
    await tx
      .delete(benchmarks)
      .where(
        and(
          eq(benchmarks.runnerId, runnerId),
          distances.length ? notInArray(benchmarks.distance, distances) : undefined,
        ),
      );
    if (!update.benchmarks.length) return;
    await tx
      .insert(benchmarks)
      .values(update.benchmarks.map((b) => ({ runnerId, ...b, source: 'runner' as const })))
      .onConflictDoUpdate({
        target: [benchmarks.runnerId, benchmarks.distance],
        set: { seconds: sql`excluded.seconds`, source: 'runner', updatedAt: new Date() },
        setWhere: sql`${benchmarks.seconds} <> excluded.seconds`,
      });
  });
}
