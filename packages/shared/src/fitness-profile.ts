import type { BenchmarkDistanceId } from './benchmarks.js';
import type { RecordGender } from './target-record.js';
import type { BenchmarkTime } from './vdot.js';

/**
 * Where a Benchmark's value came from: `runner` means the Runner entered it (pinned);
 * `generated` means it follows the Fitness Profile generated from their runs.
 */
export const BENCHMARK_SOURCES = ['runner', 'generated'] as const;
export type BenchmarkSource = (typeof BENCHMARK_SOURCES)[number];

/** A Benchmark longer than this is a typo, not a run. */
export const MAX_BENCHMARK_SECONDS = 24 * 60 * 60;

export type Benchmark = {
  distance: BenchmarkDistanceId;
  seconds: number;
  source: BenchmarkSource;
  /**
   * The applied generation's value at this distance (null without one), so a pinned row can
   * show "generated X · use generated".
   */
  generatedSeconds: number | null;
  /** Pace slower than a longer Benchmark's: ignored by the Predicted Time model. */
  soft: boolean;
  /** ISO 8601 timestamp of the last change. */
  updatedAt: string;
};

/** A run a generation was estimated from, for the "Estimated from …" sentence. */
export type ProfileSourceRun = {
  activityId: number;
  name: string;
  /** ISO 8601 start time. */
  startDate: string;
  /** The Benchmark distance the run is nearest. */
  benchmark: BenchmarkDistanceId;
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
};

/** A Fitness Profile generated from the Runner's runs. */
export type ProfileGeneration = {
  vdot: number;
  /** The one or two runs it was estimated from, best first (runs since deleted are left out). */
  sources: ProfileSourceRun[];
  /** ISO 8601. */
  generatedAt: string;
};

/** A newer generation waiting for the Runner to apply or dismiss it. */
export type ProfileSuggestion = ProfileGeneration & {
  /** All 13 suggested values; applying changes only the unpinned Benchmarks. */
  benchmarks: BenchmarkTime[];
};

/** What the `/api/fitness-profile` endpoints return. */
export type FitnessProfile = {
  /** One Benchmark per distance that has one, shortest first. */
  benchmarks: Benchmark[];
  /** The applied generation; null when none has been applied or no run qualified. */
  generation: ProfileGeneration | null;
  suggestion: ProfileSuggestion | null;
};

/**
 * One row of `PUT /api/fitness-profile`: a time pins the Benchmark (unless unchanged);
 * `useGenerated` unpins it back to the generated value.
 */
export type FitnessProfileUpdateRow =
  | { distance: BenchmarkDistanceId; seconds: number }
  | { distance: BenchmarkDistanceId; useGenerated: true };

/**
 * The body of `PUT /api/fitness-profile`: the Runner's complete set of Benchmarks.
 * Distances left out are cleared.
 */
export type FitnessProfileUpdate = {
  benchmarks: FitnessProfileUpdateRow[];
};

/** The body of `POST /api/fitness-profile/update-all`: the one time to re-derive all 13 from. */
export type UpdateAllRequest = BenchmarkTime;

/** The body and reply of `PUT /api/preferences`. */
export type Preferences = { recordGender: RecordGender };
