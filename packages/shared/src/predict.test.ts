import { describe, expect, it } from 'vitest';
import { flatPredictedTime } from './flat-model.js';
import { predict, type PredictBenchmark, type PredictSegment } from './predict.js';
import { benchmarksFromVdot } from './vdot.js';

/** All 13 at VDOT 50, none pinned. */
const unpinned: PredictBenchmark[] = benchmarksFromVdot(50);
const oneRowPinned: PredictBenchmark[] = unpinned.map((b) =>
  b.distance === '5k' ? { ...b, source: 'runner' } : b,
);

/** Minetti's cost of running at grade i, relative to flat. */
function minetti(i: number): number {
  return (155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6) / 3.6;
}

/** A smooth Segment: no climbing beyond its net gain, max grade = average grade. */
function segment(metres: number, averageGrade: number, extra: Partial<PredictSegment> = {}) {
  return {
    metres,
    averageGrade,
    maximumGrade: averageGrade,
    totalElevationGain: Math.max(0, metres * averageGrade),
    ...extra,
  };
}

function flatSeconds(metres: number): number {
  return flatPredictedTime(unpinned, metres).prediction!.seconds;
}

describe('predict', () => {
  it('runs a flat Segment through the flat model at high confidence', () => {
    expect(predict(unpinned, segment(1500, 0), null)).toEqual({
      seconds: flatSeconds(1500),
      confidence: 'high',
      reason: 'within-range',
    });
  });

  it('orders the same distance downhill < flat < uphill', () => {
    const down = predict(unpinned, segment(1000, -0.05), null)!.seconds;
    const flat = predict(unpinned, segment(1000, 0), null)!.seconds;
    const up = predict(unpinned, segment(1000, 0.05), null)!.seconds;
    expect(down).toBeLessThan(flat);
    expect(flat).toBeLessThan(up);
  });

  it.each([0.02, 0.1])("uses Minetti's Cr(i) / 3.6 uphill at %s", (grade) => {
    expect(predict(unpinned, segment(1000, grade), null)!.seconds).toBeCloseTo(
      flatSeconds(1000 * minetti(grade)),
      6,
    );
  });

  describe('downhill', () => {
    it('is capped at 0.88 of the flat distance at -9.5%', () => {
      expect(predict(unpinned, segment(2000, -0.095), null)!.seconds).toBeCloseTo(
        flatSeconds(2000 * 0.88),
        6,
      );
    });

    it('is fastest at the cap, slower on gentler and steeper descents', () => {
      const at = (grade: number) => predict(unpinned, segment(2000, grade), null)!.seconds;
      expect(at(-0.095)).toBeLessThan(at(-0.05));
      expect(at(-0.095)).toBeLessThan(at(-0.14));
      expect(at(-0.14)).toBeLessThan(at(0));
    });

    it('eases linearly back to flat by -20%', () => {
      // Halfway between -9.5% and -20%: halfway between 0.88 and 1.0.
      expect(predict(unpinned, segment(2000, -0.1475), null)!.seconds).toBeCloseTo(
        flatSeconds(2000 * 0.94),
        6,
      );
      for (const grade of [-0.2, -0.3]) {
        expect(predict(unpinned, segment(2000, grade), null)!.seconds).toBeCloseTo(
          flatSeconds(2000),
          6,
        );
      }
    });
  });

  describe('rolling', () => {
    it('is low confidence, adding 8 m of flat per metre of climbing beyond the net gain', () => {
      // Net gain 10 m, so rolling above 2 × 10 + 10 = 30 m. 40 m climbed is 30 m in excess.
      const prediction = predict(unpinned, segment(1000, 0.01, { totalElevationGain: 40 }), null);
      expect(prediction).toMatchObject({ confidence: 'low', reason: 'rolling' });
      expect(prediction!.seconds).toBeCloseTo(flatSeconds(1000 * minetti(0.01) + 8 * 30), 6);
    });

    it('is not rolling at exactly the threshold', () => {
      expect(
        predict(unpinned, segment(1000, 0.01, { totalElevationGain: 30 }), null),
      ).toMatchObject({ confidence: 'high', reason: 'within-range' });
    });

    it('counts all climbing on a descent as excess', () => {
      // Net gain 0, so rolling above 10 m.
      const prediction = predict(unpinned, segment(1000, -0.03, { totalElevationGain: 11 }), null);
      expect(prediction).toMatchObject({ confidence: 'low', reason: 'rolling' });
      const downhillFactor = 1 - 0.12 * (0.03 / 0.095);
      expect(prediction!.seconds).toBeCloseTo(flatSeconds(1000 * downhillFactor + 8 * 11), 6);
    });
  });

  it('is low confidence when the maximum grade is steeper than ±15%', () => {
    for (const maximumGrade of [0.16, -0.16]) {
      expect(predict(unpinned, segment(1000, 0.02, { maximumGrade }), null)).toMatchObject({
        confidence: 'low',
        reason: 'steep',
      });
    }
    expect(predict(unpinned, segment(1000, 0.02, { maximumGrade: 0.15 }), null)).toMatchObject({
      confidence: 'high',
    });
  });

  describe('outside the Benchmark range', () => {
    it('is low confidence under 400 m', () => {
      expect(predict(unpinned, segment(300, 0), null)).toMatchObject({
        confidence: 'low',
        reason: 'outside-benchmark-range',
      });
    });

    it('is judged on the equivalent flat distance', () => {
      const fiveAndTen: PredictBenchmark[] = [
        { distance: '5k', seconds: 1200 },
        { distance: '10k', seconds: 2520 },
      ];
      expect(predict(fiveAndTen, segment(4000, 0), null)).toMatchObject({
        confidence: 'low',
        reason: 'outside-benchmark-range',
      });
      // 4 km at 5% is about 5.2 km of flat: inside the range.
      expect(predict(fiveAndTen, segment(4000, 0.05), null)).toMatchObject({
        confidence: 'high',
        reason: 'within-range',
      });
      expect(predict(fiveAndTen, segment(12000, 0), null)).toMatchObject({
        confidence: 'low',
        reason: 'outside-benchmark-range',
      });
    });
  });

  describe('PB floor', () => {
    const steepShort = segment(300, 0.2, { maximumGrade: 0.3 });

    it('sets the time to a faster Segment PB, at high confidence', () => {
      expect(predict(unpinned, steepShort, null)!.confidence).toBe('low');
      expect(predict(unpinned, steepShort, 60)).toEqual({
        seconds: 60,
        confidence: 'high',
        reason: 'pb-floor',
      });
    });

    it('leaves the model time when the PB is slower', () => {
      const model = predict(unpinned, segment(1000, 0), null)!;
      expect(predict(unpinned, segment(1000, 0), model.seconds + 30)).toEqual(model);
    });

    it('is switched off by any pinned Benchmark', () => {
      const model = predict(oneRowPinned, steepShort, null)!;
      expect(model.seconds).toBeGreaterThan(60);
      expect(predict(oneRowPinned, steepShort, 60)).toEqual(model);
    });
  });

  it('gives no prediction with fewer than two usable Benchmarks, even with a PB', () => {
    expect(predict([], segment(1000, 0), 100)).toBeNull();
    expect(predict([{ distance: '5k', seconds: 1200 }], segment(1000, 0), 100)).toBeNull();
    // The 1K is soft (slower pace than the 5K), leaving one usable.
    const oneSoft: PredictBenchmark[] = [
      { distance: '1k', seconds: 300 },
      { distance: '5k', seconds: 1200 },
    ];
    expect(predict(oneSoft, segment(1000, 0), null)).toBeNull();
  });
});
