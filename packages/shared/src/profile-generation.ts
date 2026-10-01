import { BENCHMARK_DISTANCES, type BenchmarkDistanceId } from './benchmarks.js';
import {
  PROFILE_BAND_MAX,
  PROFILE_BAND_MIN,
  PROFILE_WINDOW_YEARS,
  SECOND_RUN_VDOT_GUARD,
} from './tunables.js';
import { benchmarksFromVdot, vdotOf, type BenchmarkTime } from './vdot.js';

// TODO(decision): which Strava sport types count as runs. Treadmill (VirtualRun) and trail runs
// are included; the spec only says "runs".
export const RUN_SPORT_TYPES = ['Run', 'TrailRun', 'VirtualRun'] as const;

/** The fields of a Strava activity summary that Fitness Profile generation reads. */
export type ProfileActivity = {
  id: number;
  name: string;
  sportType: string;
  /** ISO 8601 start time. */
  startDate: string;
  /** Metres. */
  distance: number;
  /** Seconds. Elapsed time is never used: it includes standing around. */
  movingTime: number;
};

/** A run that set the VDOT, scored at the Benchmark distance it falls near. */
export type SourceRun = {
  activityId: number;
  name: string;
  startDate: string;
  benchmark: BenchmarkDistanceId;
  distance: number;
  movingTime: number;
  vdot: number;
};

export type GeneratedFitnessProfile = {
  vdot: number;
  /** The one or two runs averaged into the VDOT, best first. */
  sources: SourceRun[];
  benchmarks: BenchmarkTime[];
};

function isRun(activity: ProfileActivity): boolean {
  return (RUN_SPORT_TYPES as readonly string[]).includes(activity.sportType);
}

function windowStart(now: Date): number {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - PROFILE_WINDOW_YEARS);
  return start.getTime();
}

/**
 * Generate a Fitness Profile from the Runner's activities: the fastest run near each Benchmark
 * distance (moving time scaled to the distance), VDOT-scored, averaging the best two when the
 * second is within SECOND_RUN_VDOT_GUARD of the best. Null when no run qualifies.
 */
export function generateFitnessProfile(
  activities: readonly ProfileActivity[],
  now: Date,
): GeneratedFitnessProfile | null {
  const since = windowStart(now);
  const runs = activities.filter(
    (a) =>
      isRun(a) &&
      a.distance > 0 &&
      a.movingTime > 0 &&
      Date.parse(a.startDate) >= since &&
      Date.parse(a.startDate) <= now.getTime(),
  );

  const bests: SourceRun[] = [];
  for (const d of BENCHMARK_DISTANCES) {
    let best: SourceRun | undefined;
    for (const run of runs) {
      if (run.distance < PROFILE_BAND_MIN * d.metres || run.distance > PROFILE_BAND_MAX * d.metres)
        continue;
      const vdot = vdotOf(d.metres, (run.movingTime * d.metres) / run.distance);
      if (!best || vdot > best.vdot) {
        best = {
          activityId: run.id,
          name: run.name,
          startDate: run.startDate,
          benchmark: d.id,
          distance: run.distance,
          movingTime: run.movingTime,
          vdot,
        };
      }
    }
    if (best) bests.push(best);
  }

  const [first, second] = bests.sort((a, b) => b.vdot - a.vdot);
  if (!first) return null;
  const sources =
    second && first.vdot - second.vdot <= SECOND_RUN_VDOT_GUARD ? [first, second] : [first];
  const vdot = sources.reduce((sum, r) => sum + r.vdot, 0) / sources.length;
  return { vdot, sources, benchmarks: benchmarksFromVdot(vdot) };
}
