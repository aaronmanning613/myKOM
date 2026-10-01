import { formatTime, type FitnessProfile, type ProfileGeneration } from '@mykom/shared';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "Estimated from …": the runs the applied generation came from, or why there's none. */
export function EstimatedFrom({ profile }: { profile: FitnessProfile }) {
  const generation: ProfileGeneration | null = profile.generation;
  if (!generation) {
    return (
      <p className="mt-2 text-gray-700">
        We didn’t find any race-like runs in your last 3 years, so there’s nothing to estimate your
        Benchmarks from.
        {profile.benchmarks.length < 2 && (
          <>
            {' '}
            Enter one time you could run today, then choose <strong>Update all from this</strong>.
          </>
        )}
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
