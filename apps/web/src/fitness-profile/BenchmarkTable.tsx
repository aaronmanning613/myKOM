import {
  BENCHMARK_DISTANCES,
  MAX_BENCHMARK_SECONDS,
  formatPace,
  formatTime,
  pacePerKm,
  parseTime,
  type Benchmark,
  type BenchmarkDistanceId,
  type FitnessProfile,
  type FitnessProfileUpdateRow,
} from '@mykom/shared';
import { useRef, useState, type KeyboardEvent } from 'react';
import { fitnessProfileApi } from './api';

/** An empty time is fine (no Benchmark for that distance); anything else must parse. */
type Validated =
  { kind: 'empty' } | { kind: 'valid'; seconds: number } | { kind: 'invalid'; error: string };

function validate(text: string): Validated {
  if (text.trim() === '') return { kind: 'empty' };
  const parsed = parseTime(text);
  if (!parsed.ok) return { kind: 'invalid', error: parsed.error };
  if (parsed.seconds > MAX_BENCHMARK_SECONDS) {
    return { kind: 'invalid', error: 'Time must be under 24 hours' };
  }
  return { kind: 'valid', seconds: parsed.seconds };
}

const labelOf = (id: BenchmarkDistanceId) =>
  BENCHMARK_DISTANCES.find((d) => d.id === id)?.label ?? id;

type Message = { kind: 'status' | 'alert'; text: string } | null;

/**
 * The 13 Benchmarks as an editable table. A row saves when the Runner leaves it (or presses
 * Enter), which pins it; the row just edited offers "Update all from this". Every change goes
 * through the API, and `onProfile` gets the Fitness Profile it answers with.
 */
export function BenchmarkTable({
  profile,
  onProfile,
}: {
  profile: FitnessProfile;
  onProfile: (profile: FitnessProfile) => void;
}) {
  // What the Runner has typed and not yet saved, by row; other rows show the saved value.
  const [edits, setEdits] = useState<Partial<Record<BenchmarkDistanceId, string>>>({});
  // Rows whose invalid time should show its error: once left, not while typing a first time.
  const [touched, setTouched] = useState<ReadonlySet<BenchmarkDistanceId>>(new Set());
  const [lastEdited, setLastEdited] = useState<BenchmarkDistanceId | null>(null);
  const [message, setMessage] = useState<Message>(null);

  // Changes run one at a time, each built from the latest saved profile, so a quick second edit
  // can't send the first row's old value back.
  const latest = useRef(profile);
  latest.current = profile;
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const saved = new Map<BenchmarkDistanceId, Benchmark>(
    profile.benchmarks.map((b) => [b.distance, b]),
  );
  const anyPinned = profile.benchmarks.some((b) => b.source === 'runner');

  function change(
    run: () => Promise<FitnessProfile>,
    done: (profile: FitnessProfile) => void,
    failure: string,
  ) {
    queue.current = queue.current.then(async () => {
      try {
        const next = await run();
        latest.current = next;
        onProfile(next);
        done(next);
      } catch {
        setMessage({ kind: 'alert', text: failure });
      }
    });
  }

  /** The saved Benchmarks as PUT rows, with `row` replacing (or, when null, clearing) one. */
  function rowsWith(distance: BenchmarkDistanceId, row: FitnessProfileUpdateRow | null) {
    const rows: FitnessProfileUpdateRow[] = latest.current.benchmarks
      .filter((b) => b.distance !== distance)
      .map((b) => ({ distance: b.distance, seconds: b.seconds }));
    if (row) rows.push(row);
    return { benchmarks: rows };
  }

  function forget(id: BenchmarkDistanceId) {
    setEdits((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTouched((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function commit(id: BenchmarkDistanceId) {
    const text = edits[id];
    if (text === undefined) return;
    const result = validate(text);
    const current = saved.get(id);
    if (result.kind === 'invalid') {
      setTouched((t) => new Set(t).add(id));
      return;
    }
    const seconds = result.kind === 'valid' ? result.seconds : null;
    if (seconds === (current?.seconds ?? null)) return forget(id);

    setMessage({ kind: 'status', text: 'Saving…' });
    change(
      () =>
        fitnessProfileApi.save(rowsWith(id, seconds === null ? null : { distance: id, seconds })),
      () => {
        forget(id);
        setLastEdited(seconds === null ? null : id);
        setMessage({ kind: 'status', text: 'Saved.' });
      },
      'Couldn’t save your Fitness Profile. Please try again.',
    );
  }

  function revertToGenerated(id: BenchmarkDistanceId) {
    change(
      () => fitnessProfileApi.save(rowsWith(id, { distance: id, useGenerated: true })),
      () => {
        forget(id);
        if (lastEdited === id) setLastEdited(null);
        setMessage({ kind: 'status', text: `${labelOf(id)} is back to the generated time.` });
      },
      'Couldn’t save your Fitness Profile. Please try again.',
    );
  }

  function updateAllFrom(benchmark: Benchmark) {
    const from = `${labelOf(benchmark.distance)} of ${formatTime(benchmark.seconds)}`;
    change(
      () =>
        fitnessProfileApi.updateAll({ distance: benchmark.distance, seconds: benchmark.seconds }),
      () => {
        setEdits({});
        setTouched(new Set());
        setLastEdited(null);
        setMessage({ kind: 'status', text: `All Benchmarks updated from your ${from}.` });
      },
      'Couldn’t update your Benchmarks. Please try again.',
    );
  }

  function resetAll() {
    change(
      () => fitnessProfileApi.reset(),
      () => {
        setEdits({});
        setTouched(new Set());
        setLastEdited(null);
        setMessage({ kind: 'status', text: 'All Benchmarks reset to generated.' });
      },
      'Couldn’t reset your Benchmarks. Please try again.',
    );
  }

  function commitOnEnter(event: KeyboardEvent<HTMLInputElement>, id: BenchmarkDistanceId) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(id);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm">
        <p role="status" className="text-gray-700">
          {message?.kind === 'status' && message.text}
        </p>
        {message?.kind === 'alert' && (
          <p role="alert" className="text-red-700">
            {message.text}
          </p>
        )}
        {anyPinned && profile.generation && (
          <button
            type="button"
            onClick={resetAll}
            className="ml-auto text-orange-700 underline hover:text-orange-800"
          >
            Reset all to generated
          </button>
        )}
      </div>
      <table className="mt-2 w-full table-fixed text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th scope="col" className="w-24 py-1 font-normal sm:w-32">
              Distance
            </th>
            <th scope="col" className="w-28 font-normal sm:w-44">
              Your Benchmark
            </th>
            <th scope="col" className="font-normal">
              <span className="sr-only">Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {BENCHMARK_DISTANCES.map((distance) => {
            const id = distance.id;
            const benchmark = saved.get(id);
            const text = edits[id] ?? (benchmark ? formatTime(benchmark.seconds) : '');
            const result = validate(text);
            const error = result.kind === 'invalid' && touched.has(id) ? result.error : null;
            const pinned = benchmark?.source === 'runner';
            const inputId = `benchmark-${id}`;
            return (
              <tr key={id} className="border-t border-gray-200 align-top">
                <th scope="row" className="py-3 pr-2 text-left font-medium">
                  <label htmlFor={inputId}>{distance.label}</label>
                </th>
                <td className="py-2">
                  <input
                    id={inputId}
                    type="text"
                    autoComplete="off"
                    placeholder="m:ss"
                    value={text}
                    onChange={(event) => setEdits((e) => ({ ...e, [id]: event.target.value }))}
                    onBlur={() => commit(id)}
                    onKeyDown={(event) => commitOnEnter(event, id)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : `${inputId}-pace`}
                    className={`w-24 rounded border px-2 py-1 tabular-nums ${
                      error
                        ? 'border-red-600'
                        : pinned
                          ? 'border-orange-500 bg-orange-50 font-semibold text-orange-900'
                          : 'border-gray-300'
                    }`}
                  />
                  <span id={`${inputId}-pace`} className="block text-xs text-gray-500">
                    {result.kind === 'valid' &&
                      formatPace(pacePerKm(result.seconds, distance.metres))}
                  </span>
                  {error && (
                    <span id={`${inputId}-error`} className="block text-xs text-red-700">
                      {error}
                    </span>
                  )}
                </td>
                <td className="py-3 text-gray-600">
                  {pinned && (
                    <span className="mr-2">
                      <span className="whitespace-nowrap">📌 yours</span>
                      {benchmark.generatedSeconds !== null && (
                        <>
                          {' · '}
                          <span className="whitespace-nowrap">
                            generated {formatTime(benchmark.generatedSeconds)}
                          </span>
                          {' · '}
                          <button
                            type="button"
                            onClick={() => revertToGenerated(id)}
                            aria-label={`Use generated ${distance.label}`}
                            className="whitespace-nowrap text-orange-700 underline hover:text-orange-800"
                          >
                            use generated
                          </button>
                        </>
                      )}
                    </span>
                  )}
                  {benchmark?.soft && (
                    <span className="mr-2 text-amber-700">
                      ⚠ soft: slower pace than a longer Benchmark, so predictions ignore it
                    </span>
                  )}
                  {pinned && lastEdited === id && (
                    <button
                      type="button"
                      onClick={() => updateAllFrom(benchmark)}
                      className="mt-1 rounded bg-orange-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-orange-700"
                    >
                      Update all from this
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
