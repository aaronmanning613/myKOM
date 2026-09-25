const METRES_PER_MILE = 1609.344;

/**
 * The standard distances a Runner has a Benchmark for: the Strava best-effort
 * distances relevant to Segments. The single place to change the list.
 */
export const BENCHMARK_DISTANCES = [
  { id: '400m', label: '400m', metres: 400 },
  { id: 'half-mile', label: '1/2 mile', metres: METRES_PER_MILE / 2 },
  { id: '1k', label: '1K', metres: 1000 },
  { id: '1-mile', label: '1 mile', metres: METRES_PER_MILE },
  { id: '2-mile', label: '2 mile', metres: METRES_PER_MILE * 2 },
  { id: '5k', label: '5K', metres: 5000 },
  { id: '10k', label: '10K', metres: 10000 },
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
