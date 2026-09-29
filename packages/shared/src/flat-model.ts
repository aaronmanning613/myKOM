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

type Point = { distance: BenchmarkDistanceId; metres: number; seconds: number };

function toPoints(benchmarks: readonly BenchmarkTime[]): Point[] {
  return benchmarks
    .map((b) => ({ ...b, metres: getBenchmarkDistance(b.distance).metres }))
    .sort((a, b) => a.metres - b.metres);
}

function isSoft(point: Point, points: readonly Point[]): boolean {
  const pace = point.seconds / point.metres;
  return points.some((p) => p.metres > point.metres && p.seconds / p.metres < pace);
}

/** Soft Benchmarks: pace slower than some longer Benchmark's pace. Shortest first. */
export function softBenchmarks(benchmarks: readonly BenchmarkTime[]): BenchmarkDistanceId[] {
  const points = toPoints(benchmarks);
  return points.filter((p) => isSoft(p, points)).map((p) => p.distance);
}

function exponent(a: Point, b: Point): number {
  return Math.log(b.seconds / a.seconds) / Math.log(b.metres / a.metres);
}

function clampExponent(k: number): number {
  return Math.min(EXTRAPOLATION_EXPONENT_MAX, Math.max(EXTRAPOLATION_EXPONENT_MIN, k));
}

function along(from: Point, k: number, metres: number): number {
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
  const soft = points.filter((p) => isSoft(p, points));
  const usable = points.filter((p) => !soft.includes(p));
  const result = (prediction: FlatPrediction | null): FlatModelResult => ({
    soft: soft.map((p) => p.distance),
    prediction,
  });
  if (usable.length < MIN_USABLE_BENCHMARKS) return result(null);

  const first = usable[0]!;
  const second = usable[1]!;
  const last = usable[usable.length - 1]!;
  const beforeLast = usable[usable.length - 2]!;

  if (metres < first.metres) {
    const k = clampExponent(exponent(first, second));
    return result({ seconds: along(first, k, metres), confidence: 'low' });
  }
  if (metres > last.metres) {
    const k = clampExponent(exponent(beforeLast, last));
    return result({ seconds: along(last, k, metres), confidence: 'low' });
  }
  if (metres === last.metres) return result({ seconds: last.seconds, confidence: 'high' });

  const i = usable.findIndex((p) => p.metres > metres);
  const lower = usable[i - 1]!;
  const upper = usable[i]!;
  return result({ seconds: along(lower, exponent(lower, upper), metres), confidence: 'high' });
}
