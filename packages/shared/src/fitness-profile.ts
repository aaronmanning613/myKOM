import type { BenchmarkDistanceId } from './benchmarks.js';

/** Where a Benchmark came from: entered by the Runner, or imported from Strava's best efforts. */
export const BENCHMARK_SOURCES = ['runner', 'strava'] as const;
export type BenchmarkSource = (typeof BENCHMARK_SOURCES)[number];

/** A Benchmark longer than this is a typo, not a run. */
export const MAX_BENCHMARK_SECONDS = 24 * 60 * 60;

export type Benchmark = {
  distance: BenchmarkDistanceId;
  seconds: number;
  source: BenchmarkSource;
  /** ISO 8601 timestamp of the last change. */
  updatedAt: string;
};

/** What `GET` and `PUT /api/fitness-profile` return: one Benchmark per distance that has one. */
export type FitnessProfile = {
  benchmarks: Benchmark[];
};

/**
 * The body of `PUT /api/fitness-profile`: the Runner's complete set of Benchmarks.
 * Distances left out are cleared.
 */
export type FitnessProfileUpdate = {
  benchmarks: { distance: BenchmarkDistanceId; seconds: number }[];
};
