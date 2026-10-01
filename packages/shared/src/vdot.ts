import {
  BENCHMARK_DISTANCES,
  getBenchmarkDistance,
  type BenchmarkDistanceId,
} from './benchmarks.js';

// Daniels & Gilbert: the oxygen cost of running at a speed, and the fraction of VO2max a
// Runner can hold for a duration. VDOT is their ratio.
function vo2(metresPerMinute: number): number {
  return -4.6 + 0.182258 * metresPerMinute + 0.000104 * metresPerMinute ** 2;
}

function fractionOfMax(minutes: number): number {
  return (
    0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}

/** The VDOT of running `metres` in `seconds`. */
export function vdotOf(metres: number, seconds: number): number {
  const minutes = seconds / 60;
  return vo2(metres / minutes) / fractionOfMax(minutes);
}

const MIN_SECONDS = 20;
const MAX_SECONDS = 8 * 60 * 60;

/** The whole-second time a Runner of this VDOT runs `metres` in (bisection on 20 s–8 h). */
export function timeFor(vdot: number, metres: number): number {
  let lo = MIN_SECONDS;
  let hi = MAX_SECONDS;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotOf(metres, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export type BenchmarkTime = { distance: BenchmarkDistanceId; seconds: number };

/** All 13 Benchmarks for a VDOT, shortest first. */
export function benchmarksFromVdot(vdot: number): BenchmarkTime[] {
  return BENCHMARK_DISTANCES.map((d) => ({ distance: d.id, seconds: timeFor(vdot, d.metres) }));
}

/**
 * "Update all from this": all 13 Benchmarks re-derived from one time the Runner trusts. The
 * edited distance keeps exactly the time entered.
 */
export function updateAllFrom(distance: BenchmarkDistanceId, seconds: number): BenchmarkTime[] {
  const vdot = vdotOf(getBenchmarkDistance(distance).metres, seconds);
  return benchmarksFromVdot(vdot).map((b) => (b.distance === distance ? { distance, seconds } : b));
}
