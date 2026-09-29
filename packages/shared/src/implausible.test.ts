import { describe, expect, it } from 'vitest';
import { WORLD_RECORDS, isImplausible } from './implausible.js';
import type { PredictSegment } from './predict.js';

/** A smooth Segment: no climbing beyond its net gain, max grade = average grade. */
function segment(metres: number, averageGrade = 0): PredictSegment {
  return {
    metres,
    averageGrade,
    maximumGrade: averageGrade,
    totalElevationGain: Math.max(0, metres * averageGrade),
  };
}

describe('isImplausible', () => {
  it('does not flag a 160 m / 17 s KOM (the spec case)', () => {
    // The men's table gives about 15.4 s for 160 m flat; × 1.05 is about 16.1 s.
    expect(isImplausible(17, segment(160), 'KOM')).toBe(false);
  });

  it('flags an obviously impossible record: 1 km in 1:30', () => {
    expect(isImplausible(90, segment(1000), 'KOM')).toBe(true);
    expect(isImplausible(90, segment(1000), 'QOM')).toBe(true);
  });

  it('flags a record just under world-record time × 1.05 and not one at it', () => {
    // 5000 m is a table point, so the flat world-record time is exact.
    const limit = 755.36 * 1.05;
    expect(isImplausible(Math.floor(limit), segment(5000), 'KOM')).toBe(true);
    expect(isImplausible(Math.ceil(limit), segment(5000), 'KOM')).toBe(false);
  });

  it("uses the women's table for QOMs", () => {
    // 13:30 for 5 km: credible against the men's record, not the women's.
    expect(isImplausible(810, segment(5000), 'KOM')).toBe(false);
    expect(isImplausible(810, segment(5000), 'QOM')).toBe(true);
  });

  it('grade-adjusts the world-record time', () => {
    // 3:20 for 1 km is credible on the flat but not up a 10% climb.
    expect(isImplausible(200, segment(1000, 0), 'KOM')).toBe(false);
    expect(isImplausible(200, segment(1000, 0.1), 'KOM')).toBe(true);
    // 2:05 for 1 km is implausible on the flat but credible down a -9.5% descent.
    expect(isImplausible(125, segment(1000, -0.095), 'KOM')).toBe(false);
    expect(isImplausible(125, segment(1000, 0), 'KOM')).toBe(true);
  });

  it('extrapolates past the table for very short and very long Segments', () => {
    expect(isImplausible(5, segment(60), 'KOM')).toBe(true);
    expect(isImplausible(8, segment(60), 'KOM')).toBe(false);
    expect(isImplausible(9000, segment(50_000), 'KOM')).toBe(true);
    expect(isImplausible(9600, segment(50_000), 'KOM')).toBe(false);
  });
});

describe('WORLD_RECORDS', () => {
  it('covers 100 m to the marathon for both genders, pace slowing with distance', () => {
    for (const table of Object.values(WORLD_RECORDS)) {
      expect(table.map((p) => p.metres)).toEqual([
        100, 200, 400, 800, 1500, 1609.344, 3000, 5000, 10000, 21097.5, 42195,
      ]);
      const paces = table.map((p) => p.seconds / p.metres);
      expect(paces).toEqual([...paces].sort((a, b) => a - b));
    }
  });
});
