import { describe, expect, it } from 'vitest';
import {
  BENCHMARK_DISTANCES,
  getBenchmarkDistance,
  type BenchmarkDistanceId,
} from './benchmarks.js';
import { parseTime } from './time.js';
import { benchmarksFromVdot, timeFor, updateAllFrom, vdotOf } from './vdot.js';

function seconds(time: string): number {
  const parsed = parseTime(time);
  if (!parsed.ok) throw new Error(`bad time ${time}`);
  return parsed.seconds;
}

function secondsAt(benchmarks: { distance: BenchmarkDistanceId; seconds: number }[], id: string) {
  return benchmarks.find((b) => b.distance === id)?.seconds;
}

const metres = (id: BenchmarkDistanceId) => getBenchmarkDistance(id).metres;

describe('vdotOf', () => {
  it('scores the test account (marathon 2:21:03 + 10K 30:39) at VDOT 71.1', () => {
    const vdot =
      (vdotOf(metres('marathon'), seconds('2:21:03')) + vdotOf(metres('10k'), seconds('30:39'))) /
      2;
    expect(vdot).toBeCloseTo(71.1, 1);
  });

  it('scores a faster time higher', () => {
    expect(vdotOf(5000, 900)).toBeGreaterThan(vdotOf(5000, 960));
  });
});

describe('timeFor', () => {
  it.each(BENCHMARK_DISTANCES.map((d) => [d.label, d.metres]))(
    'inverts vdotOf at %s',
    (_label, distanceMetres) => {
      const time = Math.round(distanceMetres * 0.25); // a 4:10/km Runner
      expect(timeFor(vdotOf(distanceMetres, time), distanceMetres)).toBe(time);
    },
  );
});

describe('benchmarksFromVdot', () => {
  const vdot =
    (vdotOf(metres('marathon'), seconds('2:21:03')) + vdotOf(metres('10k'), seconds('30:39'))) / 2;
  const benchmarks = benchmarksFromVdot(vdot);

  it('gives all 13 distances, shortest first', () => {
    expect(benchmarks.map((b) => b.distance)).toEqual(BENCHMARK_DISTANCES.map((d) => d.id));
  });

  it.each([
    ['5k', '14:43'],
    ['10k', '30:36'],
    ['marathon', '2:21:16'],
  ])('VDOT 71.1 gives %s in %s (±1 s)', (id, time) => {
    expect(Math.abs(secondsAt(benchmarks, id)! - seconds(time))).toBeLessThanOrEqual(1);
  });

  it('gets slower with distance', () => {
    const times = benchmarks.map((b) => b.seconds);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('updateAllFrom', () => {
  const benchmarks = updateAllFrom('5k', seconds('16:00'));

  it('keeps the edited time exactly', () => {
    expect(secondsAt(benchmarks, '5k')).toBe(960);
  });

  it.each([
    ['10k', '33:13'],
    ['half-marathon', '1:13:19'],
    ['marathon', '2:33:26'],
  ])('a 16:00 5K gives %s in %s (±1 s)', (id, time) => {
    expect(Math.abs(secondsAt(benchmarks, id)! - seconds(time))).toBeLessThanOrEqual(1);
  });

  it('sets all 13', () => {
    expect(benchmarks).toHaveLength(13);
  });
});
