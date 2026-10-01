import { describe, expect, it } from 'vitest';
import { BENCHMARK_DISTANCES } from './benchmarks.js';
import { flatPredictedTime, softBenchmarks } from './flat-model.js';
import { EXTRAPOLATION_EXPONENT_MAX, EXTRAPOLATION_EXPONENT_MIN } from './tunables.js';
import { benchmarksFromVdot, type BenchmarkTime } from './vdot.js';

const vdot50 = benchmarksFromVdot(50);

describe('flatPredictedTime', () => {
  it.each(BENCHMARK_DISTANCES.map((d) => [d.id, d.metres] as const))(
    'returns the Benchmark exactly at %s, at high confidence',
    (id, metres) => {
      const benchmark = vdot50.find((b) => b.distance === id)!;
      expect(flatPredictedTime(vdot50, metres).prediction).toEqual({
        seconds: benchmark.seconds,
        confidence: 'high',
      });
    },
  );

  it('interpolates on a straight line in log time vs log distance', () => {
    // 5K 20:00, 10K 42:00: exponent log(2.1)/log(2); at 7071 m (the log midpoint) the time
    // is the geometric mean.
    const profile: BenchmarkTime[] = [
      { distance: '5k', seconds: 1200 },
      { distance: '10k', seconds: 2520 },
    ];
    const metres = Math.sqrt(5000 * 10000);
    const { prediction } = flatPredictedTime(profile, metres);
    expect(prediction?.confidence).toBe('high');
    expect(prediction?.seconds).toBeCloseTo(Math.sqrt(1200 * 2520), 6);
  });

  it('uses only the neighbouring Benchmarks', () => {
    const profile: BenchmarkTime[] = [
      { distance: '1k', seconds: 180 },
      { distance: '5k', seconds: 1080 },
      { distance: '10k', seconds: 2280 },
    ];
    const between5and10 = flatPredictedTime(profile, 8000).prediction!.seconds;
    const k = Math.log(2280 / 1080) / Math.log(2);
    expect(between5and10).toBeCloseTo(1080 * 1.6 ** k, 6);
  });

  it('is increasing in distance across the whole profile', () => {
    let previous = 0;
    for (let metres = 200; metres <= 50000; metres += 100) {
      const seconds = flatPredictedTime(vdot50, metres).prediction!.seconds;
      expect(seconds).toBeGreaterThan(previous);
      previous = seconds;
    }
  });

  describe('outside the Benchmark range', () => {
    // 5K 20:00 and 10K 42:00 have exponent log(2.1)/log(2) ≈ 1.070, inside the clamp.
    const midSlope: BenchmarkTime[] = [
      { distance: '5k', seconds: 1200 },
      { distance: '10k', seconds: 2520 },
    ];
    const k = Math.log(2.1) / Math.log(2);

    it('extends the slope of the two shortest below the range, at low confidence', () => {
      expect(flatPredictedTime(midSlope, 1000).prediction).toEqual({
        seconds: expect.closeTo(1200 * 0.2 ** k, 6),
        confidence: 'low',
      });
    });

    it('extends the slope of the two longest above the range, at low confidence', () => {
      expect(flatPredictedTime(midSlope, 20000).prediction).toEqual({
        seconds: expect.closeTo(2520 * 2 ** k, 6),
        confidence: 'low',
      });
    });

    it('is low confidence under 400 m even with a full profile', () => {
      expect(flatPredictedTime(vdot50, 160).prediction?.confidence).toBe('low');
    });

    it('uses the nearest two usable Benchmarks at each end', () => {
      const profile: BenchmarkTime[] = [
        { distance: '1k', seconds: 180 },
        { distance: '3k', seconds: 600 },
        { distance: '10k', seconds: 2400 },
        { distance: 'marathon', seconds: 12000 },
      ];
      // Each end's exponent differs from the middle pair's and is inside the clamp.
      const low = Math.log(600 / 180) / Math.log(3);
      const high = Math.log(12000 / 2400) / Math.log(4.2195);
      expect(flatPredictedTime(profile, 500).prediction!.seconds).toBeCloseTo(180 * 0.5 ** low, 6);
      expect(flatPredictedTime(profile, 50000).prediction!.seconds).toBeCloseTo(
        12000 * (50000 / 42195) ** high,
        6,
      );
    });

    it.each([
      // Exponent log(2.4)/log(2) ≈ 1.263: clamped down.
      ['steep', 2880, EXTRAPOLATION_EXPONENT_MAX],
      // Exponent log(2.02)/log(2) ≈ 1.014: clamped up.
      ['shallow', 2424, EXTRAPOLATION_EXPONENT_MIN],
    ])('clamps a %s exponent at both ends', (_, tenK, clamped) => {
      const profile: BenchmarkTime[] = [
        { distance: '5k', seconds: 1200 },
        { distance: '10k', seconds: tenK },
      ];
      expect(flatPredictedTime(profile, 1000).prediction!.seconds).toBeCloseTo(
        1200 * 0.2 ** clamped,
        6,
      );
      expect(flatPredictedTime(profile, 20000).prediction!.seconds).toBeCloseTo(
        tenK * 2 ** clamped,
        6,
      );
    });
  });

  describe('fewer than two usable Benchmarks', () => {
    it.each<[string, BenchmarkTime[]]>([
      ['a blank profile', []],
      ['one Benchmark', [{ distance: '5k', seconds: 1200 }]],
      [
        'two Benchmarks, one soft',
        [
          { distance: '5k', seconds: 1500 },
          { distance: '10k', seconds: 2400 },
        ],
      ],
    ])('gives no prediction for %s', (_, profile) => {
      expect(flatPredictedTime(profile, 5000).prediction).toBeNull();
    });
  });

  it('ignores soft Benchmarks', () => {
    // A 3K at 5:30/km is slower than the 5K's 4:00/km: without it, 3K comes from 1K-5K.
    const profile: BenchmarkTime[] = [
      { distance: '1k', seconds: 200 },
      { distance: '3k', seconds: 990 },
      { distance: '5k', seconds: 1200 },
    ];
    const withoutSoft = profile.filter((b) => b.distance !== '3k');
    const result = flatPredictedTime(profile, 3000);
    expect(result.soft).toEqual(['3k']);
    expect(result.prediction).toEqual(flatPredictedTime(withoutSoft, 3000).prediction);
    expect(result.prediction!.seconds).toBeLessThan(990);
  });

  it('accepts Benchmarks in any order', () => {
    const shuffled = [...vdot50].reverse();
    expect(flatPredictedTime(shuffled, 7000)).toEqual(flatPredictedTime(vdot50, 7000));
  });
});

describe('softBenchmarks', () => {
  it('is empty for a consistent profile', () => {
    expect(softBenchmarks(vdot50)).toEqual([]);
  });

  it('flags a Benchmark slower in pace than any longer one', () => {
    const profile: BenchmarkTime[] = [
      { distance: '800m', seconds: 180 }, // 3:45/km, slower than the 10K's 3:30/km
      { distance: '5k', seconds: 1000 }, // 3:20/km
      { distance: '10k', seconds: 2100 }, // 3:30/km
    ];
    expect(softBenchmarks(profile)).toEqual(['800m']);
  });

  it('flags every soft Benchmark, shortest first', () => {
    const profile: BenchmarkTime[] = [
      { distance: 'marathon', seconds: 9000 }, // 3:33/km
      { distance: '5k', seconds: 1200 }, // 4:00/km
      { distance: '1k', seconds: 230 }, // 3:50/km
    ];
    expect(softBenchmarks(profile)).toEqual(['1k', '5k']);
    expect(flatPredictedTime(profile, 5000)).toEqual({ soft: ['1k', '5k'], prediction: null });
  });

  it('does not flag an equal pace', () => {
    const profile: BenchmarkTime[] = [
      { distance: '5k', seconds: 1200 },
      { distance: '10k', seconds: 2400 },
    ];
    expect(softBenchmarks(profile)).toEqual([]);
  });

  it('never flags the longest Benchmark', () => {
    const profile: BenchmarkTime[] = [
      { distance: '5k', seconds: 900 },
      { distance: 'marathon', seconds: 20000 },
    ];
    expect(softBenchmarks(profile)).toEqual([]);
  });
});
