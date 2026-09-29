const METRES_PER_MILE = 1609.344;

/**
 * The standard distances a Runner has a Benchmark for, shortest first, from
 * 400m to the marathon. The single place to change the list.
 */
export const BENCHMARK_DISTANCES = [
  { id: '400m', label: '400m', metres: 400 },
  { id: '800m', label: '800m', metres: 800 },
  { id: '1k', label: '1K', metres: 1000 },
  { id: '1-mile', label: '1 mile', metres: METRES_PER_MILE },
  { id: '3k', label: '3K', metres: 3000 },
  { id: '5k', label: '5K', metres: 5000 },
  { id: '8k', label: '8K', metres: 8000 },
  { id: '10k', label: '10K', metres: 10000 },
  { id: '15k', label: '15K', metres: 15000 },
  { id: '10-mile', label: '10 mile', metres: METRES_PER_MILE * 10 },
  { id: 'half-marathon', label: 'Half marathon', metres: 21097.5 },
  { id: '30k', label: '30K', metres: 30000 },
  { id: 'marathon', label: 'Marathon', metres: 42195 },
] as const;

export type BenchmarkDistance = (typeof BENCHMARK_DISTANCES)[number];
export type BenchmarkDistanceId = BenchmarkDistance['id'];

export function isBenchmarkDistanceId(value: unknown): value is BenchmarkDistanceId {
  return BENCHMARK_DISTANCES.some((distance) => distance.id === value);
}

export function getBenchmarkDistance(id: BenchmarkDistanceId): BenchmarkDistance {
  const distance = BENCHMARK_DISTANCES.find((d) => d.id === id);
  if (!distance) throw new Error(`Unknown Benchmark distance: ${id}`);
  return distance;
}
