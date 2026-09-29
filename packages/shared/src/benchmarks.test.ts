import { describe, expect, it } from 'vitest';
import { BENCHMARK_DISTANCES, getBenchmarkDistance, isBenchmarkDistanceId } from './benchmarks.js';

describe('BENCHMARK_DISTANCES', () => {
  it('lists the Benchmark distances shortest first', () => {
    expect(BENCHMARK_DISTANCES.map((d) => d.label)).toEqual([
      '400m',
      '1/2 mile',
      '1K',
      '1 mile',
      '2 mile',
      '5K',
      '10K',
    ]);
    const metres = BENCHMARK_DISTANCES.map((d) => d.metres);
    expect(metres).toEqual([...metres].sort((a, b) => a - b));
  });

  it('has unique ids', () => {
    const ids = BENCHMARK_DISTANCES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses statute miles', () => {
    expect(getBenchmarkDistance('1-mile').metres).toBe(1609.344);
    expect(getBenchmarkDistance('half-mile').metres).toBe(804.672);
    expect(getBenchmarkDistance('2-mile').metres).toBe(3218.688);
  });
});

describe('isBenchmarkDistanceId', () => {
  it('accepts known ids and rejects anything else', () => {
    expect(isBenchmarkDistanceId('5k')).toBe(true);
    expect(isBenchmarkDistanceId('marathon')).toBe(false);
    expect(isBenchmarkDistanceId(5)).toBe(false);
    expect(isBenchmarkDistanceId(undefined)).toBe(false);
  });
});
