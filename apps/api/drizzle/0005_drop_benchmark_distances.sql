-- The Benchmark distances went from 7 to 13: 1/2 mile and 2 mile were dropped.
DELETE FROM "benchmarks" WHERE "distance" IN ('half-mile', '2-mile');
