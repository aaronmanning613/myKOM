import { formatTime, type FitnessProfile, type ProfileGeneration } from '@mykom/shared';
import { useEffect, useState } from 'react';
import { fitnessProfileApi } from '../fitness-profile/api';
import { BenchmarkTable } from '../fitness-profile/BenchmarkTable';

type LoadState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; profile: FitnessProfile };
type Action = 'regenerate' | 'resync';
type ActionState =
  { kind: 'idle' } | { kind: 'busy'; action: Action } | { kind: 'failed'; action: Action };

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Estimated from …": the runs the applied generation came from, or why there's none. */
function EstimatedFrom({ profile }: { profile: FitnessProfile }) {
  const generation: ProfileGeneration | null = profile.generation;
  if (!generation) {
    return (
      <p className="mt-2 text-gray-700">
        We didn’t find any race-like runs in your last 3 years, so there’s nothing to estimate your
        Benchmarks from.
        {profile.benchmarks.length < 2 && ' Enter at least two times you could run today.'}
      </p>
    );
  }
  if (generation.sources.length === 0) {
    return (
      <p className="mt-2 text-gray-700">
        Estimated from runs you’ve since removed from Strava. Change anything that looks off.
      </p>
    );
  }
  return (
    <p className="mt-2 text-gray-700">
      Estimated from{' '}
      {generation.sources.map((run, i) => (
        <span key={run.activityId}>
          {i > 0 && ' and '}
          <strong>{run.name || 'a run'}</strong> ({formatTime(run.movingTime)},{' '}
          {dateFormat.format(new Date(run.startDate))})
        </span>
      ))}
      {generation.sources.length === 1 && ', your only race-like run'}. Change anything that looks
      off.
    </p>
  );
}

export function FitnessProfilePage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [action, setAction] = useState<ActionState>({ kind: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    fitnessProfileApi.load(controller.signal).then(
      (profile) => setLoad({ kind: 'ready', profile }),
      () => {
        if (!controller.signal.aborted) setLoad({ kind: 'failed' });
      },
    );
    return () => controller.abort();
  }, []);

  const setProfile = (profile: FitnessProfile) => setLoad({ kind: 'ready', profile });

  async function run(name: Action) {
    setAction({ kind: 'busy', action: name });
    try {
      setProfile(await fitnessProfileApi[name]());
      setAction({ kind: 'idle' });
    } catch {
      setAction({ kind: 'failed', action: name });
    }
  }

  const busy = action.kind === 'busy';

  return (
    <>
      <h1 className="text-2xl font-bold">Fitness Profile</h1>

      {load.kind === 'loading' && <p className="mt-6 text-gray-500">Loading your Benchmarks…</p>}
      {load.kind === 'failed' && (
        <p role="alert" className="mt-6 text-red-700">
          Couldn’t load your Fitness Profile. Reload the page to try again.
        </p>
      )}
      {load.kind === 'ready' && (
        <>
          <EstimatedFrom profile={load.profile} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => run('regenerate')}
              disabled={busy}
              className="rounded border border-orange-600 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-60"
            >
              {busy && action.action === 'regenerate'
                ? 'Checking your runs…'
                : 'Regenerate from Strava'}
            </button>
            {action.kind === 'failed' && action.action === 'regenerate' && (
              <p role="alert" className="text-sm text-red-700">
                Couldn’t regenerate from Strava. Please try again later.
              </p>
            )}
          </div>

          <div className="mt-6">
            <BenchmarkTable profile={load.profile} onProfile={setProfile} />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Editing a time pins it (📌), so it stays yours when your profile is regenerated. Leave a
            distance blank if you don’t have a time for it.
          </p>

          <section className="mt-8 max-w-2xl border-t border-gray-200 pt-4">
            <h2 className="font-semibold">Resync my runs</h2>
            <p className="mt-1 text-sm text-gray-700">
              Deleted or edited a run on Strava? Resync to pick it up. Last resynced:{' '}
              {load.profile.resyncedAt
                ? dateTimeFormat.format(new Date(load.profile.resyncedAt))
                : 'never'}
              .
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => run('resync')}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
              >
                {busy && action.action === 'resync' ? 'Resyncing…' : 'Resync my runs'}
              </button>
              {action.kind === 'failed' && action.action === 'resync' && (
                <p role="alert" className="text-sm text-red-700">
                  Couldn’t resync your runs. Please try again later.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
