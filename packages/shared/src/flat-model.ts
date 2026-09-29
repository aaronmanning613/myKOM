import { getBenchmarkDistance, type BenchmarkDistanceId } from './benchmarks.js';
import { EXTRAPOLATION_EXPONENT_MAX, EXTRAPOLATION_EXPONENT_MIN } from './tunables.js';
import type { BenchmarkTime } from './vdot.js';

/** Fewer usable (non-soft) Benchmarks than this means no Predicted Time. */
export const MIN_USABLE_BENCHMARKS = 2;

export type FlatPrediction = {
  /** Unrounded, so grade adjustments can build on it. */
  seconds: number;
  /** Low when the distance is outside the usable Benchmark range (extrapolated). */
  confidence: 'high' | 'low';
};

export type FlatModelResult = {
  /** Benchmarks ignored by the model, for the Fitness Profile page to flag. */
  soft: BenchmarkDistanceId[];
  /** Null when fewer than two Benchmarks are usable ("no prediction"). */
  prediction: FlatPrediction | null;
};

/** A known flat time at a distance: a Benchmark, or a world record at a non-Benchmark distance. */
export type FlatPoint = { metres: number; seconds: number };

type Point = FlatPoint & { distance: BenchmarkDistanceId };

function toPoints(benchmarks: readonly BenchmarkTime[]): Point[] {
  return benchmarks
    .map((b) => ({ ...b, metres: getBenchmarkDistance(b.distance).metres }))
    .sort((a, b) => a.metres - b.metres);
}

function isSoft(point: FlatPoint, points: readonly FlatPoint[]): boolean {
  const pace = point.seconds / point.metres;
  return points.some((p) => p.metres > point.metres && p.seconds / p.metres < pace);
}

/** Soft Benchmarks: pace slower than some longer Benchmark's pace. Shortest first. */
export function softBenchmarks(benchmarks: readonly BenchmarkTime[]): BenchmarkDistanceId[] {
  const points = toPoints(benchmarks);
  return points.filter((p) => isSoft(p, points)).map((p) => p.distance);
}

function exponent(a: FlatPoint, b: FlatPoint): number {
  return Math.log(b.seconds / a.seconds) / Math.log(b.metres / a.metres);
}

function clampExponent(k: number): number {
  return Math.min(EXTRAPOLATION_EXPONENT_MAX, Math.max(EXTRAPOLATION_EXPONENT_MIN, k));
}

function along(from: FlatPoint, k: number, metres: number): number {
  return from.seconds * (metres / from.metres) ** k;
}

/**
 * The flat Predicted Time for `metres` from a Fitness Profile: log-log interpolation between
 * neighbouring usable Benchmarks, and past either end the slope of the two nearest, with its
 * exponent clamped, at low confidence.
 */
export function flatPredictedTime(
  benchmarks: readonly BenchmarkTime[],
  metres: number,
): FlatModelResult {
  const points = toPoints(benchmarks);
  return {
    soft: points.filter((p) => isSoft(p, points)).map((p) => p.distance),
    prediction: flatTimeAt(points, metres),
  };
}

/**
 * The same flat model over any known times, such as the world-record table. Soft points are
 * ignored; null when fewer than two are usable.
 */
export function flatTimeAt(points: readonly FlatPoint[], metres: number): FlatPrediction | null {
  const sorted = [...points].sort((a, b) => a.metres - b.metres);
  const usable = sorted.filter((p) => !isSoft(p, sorted));
  if (usable.length < MIN_USABLE_BENCHMARKS) return null;

  const first = usable[0]!;
  const second = usable[1]!;
  const last = usable[usable.length - 1]!;
  const beforeLast = usable[usable.length - 2]!;

  if (metres < first.metres) {
    const k = clampExponent(exponent(first, second));
    return { seconds: along(first, k, metres), confidence: 'low' };
  }
  if (metres > last.metres) {
    const k = clampExponent(exponent(beforeLast, last));
    return { seconds: along(last, k, metres), confidence: 'low' };
  }
  if (metres === last.metres) return { seconds: last.seconds, confidence: 'high' };

  const i = usable.findIndex((p) => p.metres > metres);
  const lower = usable[i - 1]!;
  const upper = usable[i]!;
  return { seconds: along(lower, exponent(lower, upper), metres), confidence: 'high' };
}
