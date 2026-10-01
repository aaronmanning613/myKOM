import { describe, expect, it } from 'vitest';
import { BENCHMARK_DISTANCES, getBenchmarkDistance, isBenchmarkDistanceId } from './benchmarks.js';

describe('BENCHMARK_DISTANCES', () => {
  it('lists the 13 Benchmark distances shortest first', () => {
    expect(BENCHMARK_DISTANCES.map((d) => d.label)).toEqual([
      '400m',
      '800m',
      '1K',
      '1 mile',
      '3K',
      '5K',
      '8K',
      '10K',
      '15K',
      '10 mile',
      'Half marathon',
      '30K',
      'Marathon',
    ]);
    const metres = BENCHMARK_DISTANCES.map((d) => d.metres);
    expect(metres).toEqual([...metres].sort((a, b) => a - b));
  });

  it('has unique ids', () => {
    const ids = BENCHMARK_DISTANCES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses statute miles and the standard road distances', () => {
    expect(getBenchmarkDistance('1-mile').metres).toBe(1609.344);
    expect(getBenchmarkDistance('10-mile').metres).toBe(16093.44);
    expect(getBenchmarkDistance('half-marathon').metres).toBe(21097.5);
    expect(getBenchmarkDistance('marathon').metres).toBe(42195);
  });
});

describe('isBenchmarkDistanceId', () => {
  it('accepts known ids and rejects anything else', () => {
    expect(isBenchmarkDistanceId('5k')).toBe(true);
    expect(isBenchmarkDistanceId('marathon')).toBe(true);
    expect(isBenchmarkDistanceId('half-mile')).toBe(false);
    expect(isBenchmarkDistanceId('2-mile')).toBe(false);
    expect(isBenchmarkDistanceId(5)).toBe(false);
    expect(isBenchmarkDistanceId(undefined)).toBe(false);
  });
});
