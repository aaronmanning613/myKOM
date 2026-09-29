import type { BenchmarkSource } from './fitness-profile.js';
import { flatPredictedTime } from './flat-model.js';
import {
  DOWNHILL_CAP_FACTOR,
  DOWNHILL_CAP_GRADE,
  DOWNHILL_FLAT_AGAIN_GRADE,
  LOW_CONFIDENCE_MAX_GRADE,
  ROLLING_PENALTY_M_PER_M,
  ROLLING_THRESHOLD_EXTRA_M,
  ROLLING_THRESHOLD_MULTIPLIER,
} from './tunables.js';
import type { BenchmarkTime } from './vdot.js';

/** What the Predicted Time model reads from a Segment. Grades are fractions (0.05 = 5%). */
export type PredictSegment = {
  metres: number;
  averageGrade: number;
  maximumGrade: number;
  /** Strava's `total_elevation_gain`, in metres. */
  totalElevationGain: number;
};

/** A Benchmark for `predict`; `source: 'runner'` means pinned, which switches off the PB floor. */
export type PredictBenchmark = BenchmarkTime & { source?: BenchmarkSource };

/** Why a Predicted Time has its Prediction Confidence. */
export type PredictionReason =
  'pb-floor' | 'within-range' | 'outside-benchmark-range' | 'steep' | 'rolling';

export type Prediction = {
  /** Unrounded. */
  seconds: number;
  confidence: 'high' | 'low';
  reason: PredictionReason;
};

/** Minetti's energy cost of running at grade i (J/kg/m); 3.6 on the flat. */
function minettiCost(i: number): number {
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/**
 * Equivalent flat distance per metre at an average grade: Minetti uphill; downhill capped at
 * DOWNHILL_CAP_FACTOR, easing back to 1.0 by DOWNHILL_FLAT_AGAIN_GRADE.
 */
function gradeFactor(averageGrade: number): number {
  if (averageGrade >= 0) return minettiCost(averageGrade) / 3.6;
  if (averageGrade >= DOWNHILL_CAP_GRADE) {
    // TODO(decision): the spec only fixes the peak; the factor falls linearly from 1.0 on the
    // flat to the cap at DOWNHILL_CAP_GRADE.
    return 1 + (DOWNHILL_CAP_FACTOR - 1) * (averageGrade / DOWNHILL_CAP_GRADE);
  }
  if (averageGrade >= DOWNHILL_FLAT_AGAIN_GRADE) {
    const t =
      (averageGrade - DOWNHILL_CAP_GRADE) / (DOWNHILL_FLAT_AGAIN_GRADE - DOWNHILL_CAP_GRADE);
    return DOWNHILL_CAP_FACTOR + (1 - DOWNHILL_CAP_FACTOR) * t;
  }
  return 1;
}

function netGain(segment: PredictSegment): number {
  return Math.max(0, segment.metres * segment.averageGrade);
}

/** Rolling: far more climbing than the net elevation explains. */
function isRolling(segment: PredictSegment): boolean {
  return (
    segment.totalElevationGain >
    ROLLING_THRESHOLD_MULTIPLIER * netGain(segment) + ROLLING_THRESHOLD_EXTRA_M
  );
}

/** The flat distance that costs the same effort as the Segment. */
function equivalentFlatMetres(segment: PredictSegment): number {
  const graded = segment.metres * gradeFactor(segment.averageGrade);
  if (!isRolling(segment)) return graded;
  // TODO(decision): "excess climb" is the climbing beyond the net gain (which the average grade
  // already accounts for), not beyond the rolling threshold.
  return graded + ROLLING_PENALTY_M_PER_M * (segment.totalElevationGain - netGain(segment));
}

/**
 * The Predicted Time for a Segment: its equivalent flat distance through the flat model, then
 * the PB floor (only when no Benchmark is pinned). Null when fewer than two Benchmarks are
 * usable ("no prediction").
 */
export function predict(
  benchmarks: readonly PredictBenchmark[],
  segment: PredictSegment,
  pb: number | null | undefined,
): Prediction | null {
  const flat = flatPredictedTime(benchmarks, equivalentFlatMetres(segment)).prediction;
  if (!flat) return null;

  const pinned = benchmarks.some((b) => b.source === 'runner');
  if (!pinned && pb != null && pb <= flat.seconds) {
    return { seconds: pb, confidence: 'high', reason: 'pb-floor' };
  }

  const low = (reason: PredictionReason): Prediction => ({
    seconds: flat.seconds,
    confidence: 'low',
    reason,
  });
  if (flat.confidence === 'low') return low('outside-benchmark-range');
  if (Math.abs(segment.maximumGrade) > LOW_CONFIDENCE_MAX_GRADE) return low('steep');
  if (isRolling(segment)) return low('rolling');
  return { seconds: flat.seconds, confidence: 'high', reason: 'within-range' };
}
