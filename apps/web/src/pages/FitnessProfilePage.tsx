import {
  BENCHMARK_DISTANCES,
  MAX_BENCHMARK_SECONDS,
  formatPace,
  formatTime,
  pacePerKm,
  parseTime,
  type BenchmarkDistanceId,
  type FitnessProfile,
  type FitnessProfileUpdate,
} from '@mykom/shared';
import { useEffect, useState, type FormEvent } from 'react';

type Times = Record<BenchmarkDistanceId, string>;

type LoadState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready' };
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

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

function toTimes(profile: FitnessProfile): Times {
  const times = Object.fromEntries(BENCHMARK_DISTANCES.map((d) => [d.id, ''])) as Times;
  for (const benchmark of profile.benchmarks)
    times[benchmark.distance] = formatTime(benchmark.seconds);
  return times;
}

function isFitnessProfile(value: unknown): value is FitnessProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).benchmarks)
  );
}

async function readProfile(response: Response): Promise<FitnessProfile> {
  if (!response.ok) throw new Error(`Fitness Profile request failed: ${response.status}`);
  const body: unknown = await response.json();
  if (!isFitnessProfile(body)) throw new Error('Unexpected Fitness Profile response');
  return body;
}

export function FitnessProfilePage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [times, setTimes] = useState<Times>(() =>
    toTimes({ benchmarks: [], generation: null, suggestion: null, resyncedAt: null }),
  );
  // Errors show once a row has been left or a save attempted, not while typing a first time.
  const [touched, setTouched] = useState<ReadonlySet<BenchmarkDistanceId>>(new Set());
  const [save, setSave] = useState<SaveState>('idle');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/fitness-profile', { signal: controller.signal })
      .then(readProfile)
      .then(
        (profile) => {
          setTimes(toTimes(profile));
          setLoad({ kind: 'ready' });
        },
        () => {
          if (!controller.signal.aborted) setLoad({ kind: 'failed' });
        },
      );
    return () => controller.abort();
  }, []);

  function setTime(id: BenchmarkDistanceId, value: string) {
    setTimes((current) => ({ ...current, [id]: value }));
    setSave('idle');
  }

  function touch(id: BenchmarkDistanceId) {
    setTouched((current) => new Set(current).add(id));
  }

  function clear(id: BenchmarkDistanceId) {
    setTime(id, '');
    setTouched((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(new Set(BENCHMARK_DISTANCES.map((d) => d.id)));

    const update: FitnessProfileUpdate = { benchmarks: [] };
    const invalid: BenchmarkDistanceId[] = [];
    for (const { id } of BENCHMARK_DISTANCES) {
      const result = validate(times[id]);
      if (result.kind === 'invalid') invalid.push(id);
      if (result.kind === 'valid')
        update.benchmarks.push({ distance: id, seconds: result.seconds });
    }
    if (invalid.length > 0) {
      document.getElementById(`benchmark-${invalid[0]}`)?.focus();
      return;
    }

    setSave('saving');
    try {
      const response = await fetch('/api/fitness-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      setTimes(toTimes(await readProfile(response)));
      setTouched(new Set());
      setSave('saved');
    } catch {
      setSave('failed');
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Fitness Profile</h1>
      <p className="mt-2 text-gray-700">
        Your Benchmarks: your current time for each distance. Leave a distance blank if you don’t
        have a time for it.
      </p>

      {load.kind === 'loading' && <p className="mt-6 text-gray-500">Loading your Benchmarks…</p>}
      {load.kind === 'failed' && (
        <p role="alert" className="mt-6 text-red-700">
          Couldn’t load your Fitness Profile. Reload the page to try again.
        </p>
      )}
      {load.kind === 'ready' && (
        <form onSubmit={handleSubmit} noValidate className="mt-6 max-w-xl">
          <ul className="divide-y divide-gray-200 border-y border-gray-200">
            {BENCHMARK_DISTANCES.map((distance) => {
              const id = distance.id;
              const result = validate(times[id]);
              const error = result.kind === 'invalid' && touched.has(id) ? result.error : null;
              const inputId = `benchmark-${id}`;
              return (
                <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <label htmlFor={inputId} className="w-16 font-medium">
                    {distance.label}
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    autoComplete="off"
                    placeholder="m:ss"
                    value={times[id]}
                    onChange={(event) => setTime(id, event.target.value)}
                    onBlur={() => touch(id)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : `${inputId}-pace`}
                    className={`w-28 rounded border px-2 py-1 ${
                      error ? 'border-red-600' : 'border-gray-300'
                    }`}
                  />
                  <span id={`${inputId}-pace`} className="min-w-20 text-sm text-gray-600">
                    {result.kind === 'valid' &&
                      formatPace(pacePerKm(result.seconds, distance.metres))}
                  </span>
                  <button
                    type="button"
                    onClick={() => clear(id)}
                    disabled={times[id] === ''}
                    aria-label={`Clear ${distance.label}`}
                    className="ml-auto rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:invisible"
                  >
                    Clear
                  </button>
                  {error && (
                    <p id={`${inputId}-error`} className="w-full text-sm text-red-700">
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={save === 'saving'}
              className="rounded bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-60"
            >
              {save === 'saving' ? 'Saving…' : 'Save'}
            </button>
            <p role="status" className="text-sm text-green-700">
              {save === 'saved' && 'Fitness Profile saved.'}
            </p>
            {save === 'failed' && (
              <p role="alert" className="text-sm text-red-700">
                Couldn’t save your Fitness Profile. Please try again.
              </p>
            )}
          </div>
        </form>
      )}
    </>
  );
}
