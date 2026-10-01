import {
  BENCHMARK_DISTANCES,
  benchmarksFromVdot,
  generateFitnessProfile,
  isBenchmarkDistanceId,
  softBenchmarks,
  updateAllFrom,
  type BenchmarkDistance,
  type BenchmarkDistanceId,
  type BenchmarkTime,
  type FitnessProfile,
  type FitnessProfileUpdate,
  type GeneratedFitnessProfile,
  type ProfileSourceRun,
  type SuggestionSummary,
} from '@mykom/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { activities, benchmarks, fitnessProfiles, runners } from '../db/schema.js';

type Db = Database['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const distanceOrder = (id: string) => BENCHMARK_DISTANCES.findIndex((d) => d.id === id);

/** The Benchmark distance a run is nearest (by ratio), for the "Estimated from …" sentence. */
function nearestBenchmark(metres: number): BenchmarkDistanceId {
  const off = (d: BenchmarkDistance) => Math.abs(Math.log(metres / d.metres));
  const [first, ...rest] = BENCHMARK_DISTANCES;
  return rest.reduce<BenchmarkDistance>((best, d) => (off(d) < off(best) ? d : best), first).id;
}

async function sourceRuns(db: Db, runnerId: number, ids: number[]): Promise<ProfileSourceRun[]> {
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.runnerId, runnerId), inArray(activities.id, ids)));
  // Keeps the stored order (best first); a run deleted since then is left out.
  return ids.flatMap((id) => {
    const run = rows.find((row) => row.id === id);
    if (!run) return [];
    return [
      {
        activityId: run.id,
        name: run.name,
        startDate: run.startDate.toISOString(),
        benchmark: nearestBenchmark(run.distance),
        distance: run.distance,
        movingTime: run.movingTime,
      },
    ];
  });
}

/**
 * The Runner's Fitness Profile: their Benchmarks in BENCHMARK_DISTANCES order, the applied
 * generation and any pending suggestion.
 */
export async function loadFitnessProfile(db: Db, runnerId: number): Promise<FitnessProfile> {
  const [rows, [profile], [runner]] = await Promise.all([
    db.select().from(benchmarks).where(eq(benchmarks.runnerId, runnerId)),
    db.select().from(fitnessProfiles).where(eq(fitnessProfiles.runnerId, runnerId)),
    db.select({ resyncedAt: runners.resyncedAt }).from(runners).where(eq(runners.id, runnerId)),
  ]);
  const kept = rows
    // Skips distances dropped from BENCHMARK_DISTANCES since they were saved.
    .filter((row) => isBenchmarkDistanceId(row.distance))
    .sort((a, b) => distanceOrder(a.distance) - distanceOrder(b.distance));
  const soft = new Set(softBenchmarks(kept));

  const generation =
    profile?.vdot != null && profile.generatedAt
      ? {
          vdot: profile.vdot,
          sources: await sourceRuns(db, runnerId, profile.sourceActivityIds),
          generatedAt: profile.generatedAt.toISOString(),
        }
      : null;
  const suggestion =
    profile?.suggestedVdot != null && profile.suggestedAt
      ? {
          vdot: profile.suggestedVdot,
          sources: await sourceRuns(db, runnerId, profile.suggestedSourceActivityIds ?? []),
          generatedAt: profile.suggestedAt.toISOString(),
          benchmarks: benchmarksFromVdot(profile.suggestedVdot),
        }
      : null;

  return {
    benchmarks: kept.map(({ distance, seconds, source, generatedSeconds, updatedAt }) => ({
      distance,
      seconds,
      source,
      generatedSeconds,
      soft: soft.has(distance),
      updatedAt: updatedAt.toISOString(),
    })),
    generation,
    suggestion,
    resyncedAt: runner?.resyncedAt?.toISOString() ?? null,
  };
}

/** The pending suggestion for the banner, or null when there is none. */
export async function loadSuggestionSummary(
  db: Db,
  runnerId: number,
): Promise<SuggestionSummary | null> {
  const [profile] = await db
    .select()
    .from(fitnessProfiles)
    .where(eq(fitnessProfiles.runnerId, runnerId));
  if (profile?.suggestedVdot == null) return null;
  const [source] = await sourceRuns(db, runnerId, profile.suggestedSourceActivityIds ?? []);
  return { vdot: profile.suggestedVdot, appliedVdot: profile.vdot, source: source ?? null };
}

/** The applied generation's 13 values, or null when there is none. */
async function appliedValues(
  tx: Db | Tx,
  runnerId: number,
): Promise<Map<BenchmarkDistanceId, number> | null> {
  const [profile] = await tx
    .select({ vdot: fitnessProfiles.vdot })
    .from(fitnessProfiles)
    .where(eq(fitnessProfiles.runnerId, runnerId));
  if (profile?.vdot == null) return null;
  return new Map(benchmarksFromVdot(profile.vdot).map((b) => [b.distance, b.seconds]));
}

/** A `use generated` row for a distance with no generated value. */
export class NoGeneratedValueError extends Error {
  constructor(readonly distance: BenchmarkDistanceId) {
    super(`There is no generated value for ${distance}`);
  }
}

/**
 * Writes Benchmarks with their generated values. `pin` makes them the Runner's own; otherwise
 * they become generated. A row whose value and source don't change keeps its updated_at.
 */
async function writeBenchmarks(
  tx: Tx,
  runnerId: number,
  values: BenchmarkTime[],
  generated: Map<BenchmarkDistanceId, number> | null,
  source: 'runner' | 'generated',
  now: Date,
) {
  if (!values.length) return;
  await tx
    .insert(benchmarks)
    .values(
      values.map((b) => ({
        runnerId,
        ...b,
        source,
        generatedSeconds: generated?.get(b.distance) ?? null,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [benchmarks.runnerId, benchmarks.distance],
      set: {
        seconds: sql`excluded.seconds`,
        source: sql`excluded.source`,
        generatedSeconds: sql`excluded.generated_seconds`,
        updatedAt: sql`case when ${benchmarks.seconds} <> excluded.seconds or ${benchmarks.source} <> excluded.source then excluded.updated_at else ${benchmarks.updatedAt} end`,
      },
    });
}

/**
 * Replaces the Runner's Benchmarks with `update`: distances left out are cleared, changed times
 * are pinned (`source: runner`), and `useGenerated` rows go back to the generated value. An
 * unchanged time keeps its source and updated_at.
 */
export async function saveFitnessProfile(
  db: Db,
  runnerId: number,
  update: FitnessProfileUpdate,
  now = new Date(),
): Promise<void> {
  const distances = update.benchmarks.map((b) => b.distance);
  await db.transaction(async (tx) => {
    const generated = await appliedValues(tx, runnerId);
    const timed: BenchmarkTime[] = [];
    const unpinned: BenchmarkTime[] = [];
    for (const row of update.benchmarks) {
      if ('seconds' in row) {
        timed.push({ distance: row.distance, seconds: row.seconds });
      } else {
        const seconds = generated?.get(row.distance);
        if (seconds === undefined) throw new NoGeneratedValueError(row.distance);
        unpinned.push({ distance: row.distance, seconds });
      }
    }

    // TODO(decision): clearing a Benchmark deletes it, even with a generated value; the next
    // applied generation (or Reset all to generated) brings it back.
    await tx
      .delete(benchmarks)
      .where(
        and(
          eq(benchmarks.runnerId, runnerId),
          distances.length ? notInArray(benchmarks.distance, distances) : undefined,
        ),
      );
    if (timed.length) {
      await tx
        .insert(benchmarks)
        .values(
          timed.map((b) => ({
            runnerId,
            ...b,
            source: 'runner' as const,
            generatedSeconds: generated?.get(b.distance) ?? null,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [benchmarks.runnerId, benchmarks.distance],
          set: { seconds: sql`excluded.seconds`, source: 'runner', updatedAt: now },
          setWhere: sql`${benchmarks.seconds} <> excluded.seconds`,
        });
    }
    await writeBenchmarks(tx, runnerId, unpinned, generated, 'generated', now);
  });
}

/**
 * "Update all from this": all 13 Benchmarks re-derived from one time and pinned, overwriting
 * other pins.
 */
export async function updateAllBenchmarks(
  db: Db,
  runnerId: number,
  from: BenchmarkTime,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const generated = await appliedValues(tx, runnerId);
    await writeBenchmarks(
      tx,
      runnerId,
      updateAllFrom(from.distance, from.seconds),
      generated,
      'runner',
      now,
    );
  });
}

/**
 * "Reset all to generated": every Benchmark takes the applied generation's value, unpinned.
 * False (and nothing changes) when there is no applied generation.
 */
export async function resetToGenerated(db: Db, runnerId: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const generated = await appliedValues(tx, runnerId);
    if (!generated) return false;
    const values = [...generated].map(([distance, seconds]) => ({ distance, seconds }));
    await writeBenchmarks(tx, runnerId, values, generated, 'generated', now);
    return true;
  });
}

/** Generates a Fitness Profile from the Runner's stored runs (no Strava reads). */
export async function generateFromStoredRuns(
  db: Db,
  runnerId: number,
  now: Date,
): Promise<GeneratedFitnessProfile | null> {
  const runs = await db
    .select({
      id: activities.id,
      name: activities.name,
      sportType: activities.sportType,
      startDate: activities.startDate,
      distance: activities.distance,
      movingTime: activities.movingTime,
    })
    .from(activities)
    .where(eq(activities.runnerId, runnerId));
  return generateFitnessProfile(
    runs.map((run) => ({ ...run, startDate: run.startDate.toISOString() })),
    now,
  );
}

/**
 * Makes `generation` the applied one: unpinned Benchmarks take its values, pinned ones keep
 * theirs and record it as their generated value, and any pending suggestion is cleared. A null
 * generation (no qualifying runs) blanks the generated Benchmarks.
 */
export async function applyGeneration(
  db: Db,
  runnerId: number,
  generation: Generation | null,
  now = new Date(),
): Promise<void> {
  const applied = {
    vdot: generation?.vdot ?? null,
    sourceActivityIds: generation?.sourceActivityIds ?? [],
    generatedAt: now,
    suggestedVdot: null,
    suggestedSourceActivityIds: null,
    suggestedAt: null,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(fitnessProfiles)
      .values({ runnerId, ...applied })
      .onConflictDoUpdate({ target: fitnessProfiles.runnerId, set: applied });

    const mine = eq(benchmarks.runnerId, runnerId);
    if (!generation) {
      await tx.delete(benchmarks).where(and(mine, eq(benchmarks.source, 'generated')));
      await tx
        .update(benchmarks)
        .set({ generatedSeconds: null, updatedAt: sql`${benchmarks.updatedAt}` })
        .where(mine);
      return;
    }
    const values = benchmarksFromVdot(generation.vdot);
    const generated = new Map(values.map((b) => [b.distance, b.seconds]));
    const pinned = await tx
      .select({ distance: benchmarks.distance, seconds: benchmarks.seconds })
      .from(benchmarks)
      .where(and(mine, eq(benchmarks.source, 'runner')));
    const pinnedDistances = new Set(pinned.map((b) => b.distance));
    await writeBenchmarks(
      tx,
      runnerId,
      values.filter((b) => !pinnedDistances.has(b.distance)),
      generated,
      'generated',
      now,
    );
    await writeBenchmarks(tx, runnerId, pinned, generated, 'runner', now);
  });
}

/** A generation as `fitness_profiles` stores it: its values all follow from the VDOT. */
export type Generation = { vdot: number; sourceActivityIds: number[] };

function asGeneration(profile: GeneratedFitnessProfile | null): Generation | null {
  if (!profile) return null;
  return { vdot: profile.vdot, sourceActivityIds: profile.sources.map((s) => s.activityId) };
}

/** Regenerates the Fitness Profile from the stored runs and applies it directly. */
export async function regenerateFitnessProfile(db: Db, runnerId: number, now = new Date()) {
  const generation = asGeneration(await generateFromStoredRuns(db, runnerId, now));
  await applyGeneration(db, runnerId, generation, now);
}

/**
 * After a new-run check or resync: regenerates the Fitness Profile from the stored runs and,
 * when its values for the unpinned Benchmarks differ from both the applied generation's and the
 * last dismissed suggestion's, stores it as the pending suggestion. Otherwise any pending
 * suggestion is cleared, since it no longer describes the runs. Nothing else changes until the
 * Runner applies it. Returns whether a suggestion is pending.
 */
export async function suggestFitnessProfile(
  db: Db,
  runnerId: number,
  now = new Date(),
): Promise<boolean> {
  const generation = await generateFromStoredRuns(db, runnerId, now);
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(fitnessProfiles)
      .where(eq(fitnessProfiles.runnerId, runnerId))
      .for('update');
    const pinned = await tx
      .select({ distance: benchmarks.distance })
      .from(benchmarks)
      .where(and(eq(benchmarks.runnerId, runnerId), eq(benchmarks.source, 'runner')));
    const unpinned = BENCHMARK_DISTANCES.map((d) => d.id).filter(
      (id) => !pinned.some((b) => b.distance === id),
    );
    // The values a suggestion would change, as a comparable key.
    const unpinnedValues = (values: BenchmarkTime[] | null | undefined) =>
      unpinned.map((id) => values?.find((b) => b.distance === id)?.seconds ?? null).join(',');

    const applied = profile?.vdot != null ? benchmarksFromVdot(profile.vdot) : null;
    const next = generation ? unpinnedValues(generation.benchmarks) : null;
    // TODO(decision): a generation with no qualifying runs is never suggested (the suggestion
    // columns can't hold a blank profile); the applied generation stays until Regenerate.
    const suggest =
      next !== null &&
      next !== unpinnedValues(applied) &&
      next !== unpinnedValues(profile?.dismissedBenchmarks);

    const candidate = suggest ? asGeneration(generation) : null;
    // The same suggestion still pending keeps its time.
    if (
      candidate &&
      profile?.suggestedVdot === candidate.vdot &&
      String(profile.suggestedSourceActivityIds) === String(candidate.sourceActivityIds)
    ) {
      return true;
    }

    const suggestion = candidate
      ? {
          suggestedVdot: candidate.vdot,
          suggestedSourceActivityIds: candidate.sourceActivityIds,
          suggestedAt: now,
        }
      : { suggestedVdot: null, suggestedSourceActivityIds: null, suggestedAt: null };
    if (profile) {
      await tx
        .update(fitnessProfiles)
        .set({ ...suggestion, updatedAt: now })
        .where(eq(fitnessProfiles.runnerId, runnerId));
    } else if (candidate) {
      await tx
        .insert(fitnessProfiles)
        .values({ runnerId, ...suggestion, updatedAt: now })
        .onConflictDoUpdate({ target: fitnessProfiles.runnerId, set: suggestion });
    }
    return candidate !== null;
  });
}

/**
 * Apply: the pending suggestion becomes the applied generation (unpinned Benchmarks take its
 * values). False when there is no pending suggestion.
 */
export async function applySuggestion(db: Db, runnerId: number, now = new Date()) {
  const [profile] = await db
    .select()
    .from(fitnessProfiles)
    .where(eq(fitnessProfiles.runnerId, runnerId));
  if (profile?.suggestedVdot == null) return false;
  await applyGeneration(
    db,
    runnerId,
    { vdot: profile.suggestedVdot, sourceActivityIds: profile.suggestedSourceActivityIds ?? [] },
    now,
  );
  return true;
}

/**
 * Dismiss: records the suggestion's values, so the same values aren't suggested again, and
 * clears it. False when there is no pending suggestion.
 */
export async function dismissSuggestion(db: Db, runnerId: number, now = new Date()) {
  const [profile] = await db
    .select()
    .from(fitnessProfiles)
    .where(eq(fitnessProfiles.runnerId, runnerId));
  if (profile?.suggestedVdot == null) return false;
  await db
    .update(fitnessProfiles)
    .set({
      dismissedBenchmarks: benchmarksFromVdot(profile.suggestedVdot),
      suggestedVdot: null,
      suggestedSourceActivityIds: null,
      suggestedAt: null,
      updatedAt: now,
    })
    .where(eq(fitnessProfiles.runnerId, runnerId));
  return true;
}
