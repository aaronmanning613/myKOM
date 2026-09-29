// PROTOTYPE, throwaway (wayfinder: Onboarding and Fitness Profile editing UX): in-memory
// fixtures for the Fitness Profile generation described in Historical import strategy (#9):
// the fastest whole run near each of 13 distances over 3 years, VDOT-scored, average of the
// best 2, then all 13 Benchmarks generated from that VDOT. Nothing is persisted.
import { useEffect, useState } from 'react';

export const DISTANCES = [
  { id: '400m', label: '400 m', metres: 400 },
  { id: '800m', label: '800 m', metres: 800 },
  { id: '1k', label: '1K', metres: 1000 },
  { id: 'mile', label: '1 mile', metres: 1609.34 },
  { id: '3k', label: '3K', metres: 3000 },
  { id: '5k', label: '5K', metres: 5000 },
  { id: '8k', label: '8K', metres: 8000 },
  { id: '10k', label: '10K', metres: 10000 },
  { id: '15k', label: '15K', metres: 15000 },
  { id: '10mi', label: '10 mile', metres: 16093.4 },
  { id: 'half', label: 'Half', metres: 21097.5 },
  { id: '30k', label: '30K', metres: 30000 },
  { id: 'marathon', label: 'Marathon', metres: 42195 },
] as const;
export type DistanceId = (typeof DISTANCES)[number]['id'];

// Daniels & Gilbert.
function vo2(metresPerMin: number) {
  return -4.6 + 0.182258 * metresPerMin + 0.000104 * metresPerMin ** 2;
}
function pctMax(minutes: number) {
  return (
    0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes)
  );
}
export function vdotOf(metres: number, seconds: number) {
  const minutes = seconds / 60;
  return vo2(metres / minutes) / pctMax(minutes);
}
export function timeFor(vdot: number, metres: number) {
  let lo = 20;
  let hi = 8 * 3600;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotOf(metres, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** The fastest whole run found near one Benchmark distance. */
export type SourceRun = {
  distance: DistanceId;
  name: string;
  date: string;
  metres: number;
  movingSeconds: number;
  vdot: number;
};

export type Scenario = 'races' | 'one' | 'none';

function run(
  distance: DistanceId,
  name: string,
  date: string,
  metres: number,
  movingSeconds: number,
) {
  const d = DISTANCES.find((x) => x.id === distance)!;
  // Scored at the Benchmark distance: moving time × D ÷ distance.
  const scaled = (movingSeconds * d.metres) / metres;
  return { distance, name, date, metres, movingSeconds, vdot: vdotOf(d.metres, scaled) };
}

const RUNS: Record<Scenario, SourceRun[]> = {
  races: [
    run('marathon', 'Toronto Waterfront Marathon', '2025-10-19', 42300, 2 * 3600 + 21 * 60 + 3),
    run('10k', 'Sporting Life 10K', '2026-05-10', 10020, 30 * 60 + 39),
    run('half', 'Around the Bay tune-up', '2025-09-14', 21150, 67 * 60 + 58),
    run('5k', 'High Park parkrun', '2026-06-06', 5040, 15 * 60 + 12),
    run('mile', 'Track mile', '2026-07-22', 1612, 4 * 60 + 31),
    run('15k', 'Long tempo', '2026-03-29', 15200, 52 * 60 + 40),
    run('1k', 'Warm-up loop', '2026-08-02', 1010, 3 * 60 + 58),
    run('30k', 'Sunday long run', '2026-04-12', 30400, 2 * 3600 + 2 * 60),
  ],
  one: [
    run('10k', 'Beaches Jazz 10K', '2026-07-25', 10060, 42 * 60 + 10),
    run('5k', 'Easy loop', '2026-08-30', 5010, 27 * 60 + 5),
  ],
  none: [],
};

export type Generation = {
  runs: SourceRun[];
  /** The 1 or 2 runs averaged into the VDOT. */
  scoring: SourceRun[];
  vdot: number | null;
};

export function generate(
  scenario: Scenario,
  excluded: ReadonlySet<string> = new Set(),
): Generation {
  const runs = RUNS[scenario].filter((r) => !excluded.has(r.name));
  // Easy runs score far lower than races, so they drop out once the best 2 are taken.
  const scoring = [...runs]
    .sort((a, b) => b.vdot - a.vdot)
    .slice(0, 2)
    .filter((r, i, all) => i === 0 || r.vdot > all[0]!.vdot - 8);
  const vdot = scoring.length ? scoring.reduce((s, r) => s + r.vdot, 0) / scoring.length : null;
  return { runs, scoring, vdot };
}

/** One Benchmark row: the generated time, and the Runner's pinned time if they edited it. */
export type Row = { id: DistanceId; generated: number | null; pinned: number | null };

export function rowsFor(vdot: number | null, pinned: Partial<Record<DistanceId, number>>): Row[] {
  return DISTANCES.map((d) => ({
    id: d.id,
    generated: vdot === null ? null : timeFor(vdot, d.metres),
    pinned: pinned[d.id] ?? null,
  }));
}

export function effective(row: Row) {
  return row.pinned ?? row.generated;
}

export function label(id: DistanceId) {
  return DISTANCES.find((d) => d.id === id)!.label;
}

/** A fake first crawl: runs checked and Segments found grow until done. */
export function useCrawl(running: boolean) {
  const total = 41;
  const [checked, setChecked] = useState(0);
  useEffect(() => {
    if (!running) return;
    setChecked(0);
    const timer = setInterval(() => setChecked((c) => Math.min(total, c + 1)), 250);
    return () => clearInterval(timer);
  }, [running]);
  return {
    checked,
    total,
    done: checked >= total,
    segmentsFound: Math.floor(checked * 3.4),
    targets: TARGETS.slice(0, Math.min(TARGETS.length, Math.floor(checked / 6))),
  };
}

export const TARGETS = [
  { name: 'Humber Bay Arch sprint', athletes: 18234, record: 58, predicted: 57 },
  {
    name: 'Martin Goodman: Ontario Place to Coronation',
    athletes: 9120,
    record: 312,
    predicted: 309,
  },
  { name: 'Colborne Lodge climb', athletes: 7411, record: 71, predicted: 73 },
  { name: 'Grenadier Pond loop', athletes: 5230, record: 488, predicted: 491 },
  { name: 'Spadina bridge to Bathurst', athletes: 3021, record: 140, predicted: 139 },
  { name: 'Leslie Spit lighthouse out', athletes: 2810, record: 905, predicted: 899 },
];

export function useFakeDelay(ms: number, key: unknown) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const t = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(t);
  }, [ms, key]);
  return ready;
}
