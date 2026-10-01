import type { FitnessProfile, Preferences, RecordGender, Results } from '@mykom/shared';
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth, type Me } from '../auth/AuthContext';
import { fitnessProfileApi } from '../fitness-profile/api';
import { BenchmarkTable } from '../fitness-profile/BenchmarkTable';
import { EstimatedFrom } from '../fitness-profile/EstimatedFrom';
import { ResultsSection } from '../results/ResultsSection';
import { searchAreaApi } from '../search-area/api';
import { OsmAttribution } from '../search-area/PlacePicker';
import { SearchAreaForm } from '../search-area/SearchAreaForm';
import { RESULTS_POLL_MS, shouldPoll } from './ResultsPage';

export const WIZARD_PATH = '/welcome';

const STEPS = ['Your fitness', 'Where you run', 'Your targets'] as const;
type Step = 1 | 2 | 3;

function StepBar({ step }: { step: Step }) {
  return (
    <ol aria-label="Steps" className="mb-6 flex gap-2 text-sm">
      {STEPS.map((name, i) => {
        const n = i + 1;
        const style =
          n === step
            ? 'border-orange-600 font-semibold'
            : n < step
              ? 'border-orange-300 text-gray-600'
              : 'border-gray-200 text-gray-400';
        return (
          <li
            key={name}
            aria-current={n === step ? 'step' : undefined}
            className={`flex-1 border-b-4 px-1 py-1 ${style}`}
          >
            {n}. {name}
          </li>
        );
      })}
    </ol>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-gray-700">
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-orange-600 border-t-transparent"
      />
      {text}
    </p>
  );
}

async function savePreferences(preferences: Preferences): Promise<void> {
  const response = await fetch('/api/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
  if (!response.ok) throw new Error(`/api/preferences responded ${response.status}`);
}

/** KOM or QOM, for a Runner whose Strava profile has no sex set. */
function RecordGenderQuestion({
  value,
  onChange,
}: {
  value: RecordGender | null;
  onChange: (recordGender: RecordGender) => void;
}) {
  const [failed, setFailed] = useState(false);
  const choose = async (recordGender: RecordGender) => {
    setFailed(false);
    try {
      await savePreferences({ recordGender });
      onChange(recordGender);
    } catch {
      setFailed(true);
    }
  };
  const options: { value: RecordGender; label: string }[] = [
    { value: 'KOM', label: 'KOM (the men’s record)' },
    { value: 'QOM', label: 'QOM (the women’s record)' },
  ];
  return (
    <fieldset className="mt-6 max-w-2xl rounded border border-gray-200 p-3">
      <legend className="px-1 font-semibold">Which record should you chase?</legend>
      <p className="text-sm text-gray-700">
        Your Strava profile doesn’t say, so choose which Target Records to rank you against.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1 text-sm has-checked:border-orange-600 has-checked:bg-orange-50"
          >
            <input
              type="radio"
              name="record-gender"
              value={option.value}
              checked={value === option.value}
              onChange={() => void choose(option.value)}
              className="accent-orange-600"
            />
            {option.label}
          </label>
        ))}
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          Couldn’t save your choice. Please try again.
        </p>
      )}
    </fieldset>
  );
}

/** Step 1: the generated Fitness Profile to check and edit, and KOM/QOM when Strava lacks it. */
function FitnessStep({
  me,
  onRecordGender,
  onContinue,
}: {
  me: Me;
  onRecordGender: (recordGender: RecordGender) => void;
  onContinue: () => void;
}) {
  const [profile, setProfile] = useState<FitnessProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fitnessProfileApi.load(controller.signal).then(setProfile, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);

  const askRecordGender = me.sex === null;
  const enoughBenchmarks = (profile?.benchmarks.length ?? 0) >= 2;
  const needsRecordGender = askRecordGender && me.recordGender === null;

  return (
    <>
      <h1 className="text-2xl font-bold">Here’s how fast we think you are</h1>
      {failed && (
        <p role="alert" className="mt-6 text-red-700">
          Couldn’t load your Fitness Profile. Reload the page to try again.
        </p>
      )}
      {!profile && !failed && (
        <div className="mt-6">
          <Spinner text="Reading your runs from the last 3 years…" />
        </div>
      )}
      {profile && (
        <>
          <EstimatedFrom profile={profile} />
          <div className="mt-6">
            <BenchmarkTable profile={profile} onProfile={setProfile} />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Editing a time pins it (📌), so it stays yours. You can change these any time on your
            Fitness Profile.
          </p>
          {askRecordGender && (
            <RecordGenderQuestion value={me.recordGender} onChange={onRecordGender} />
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!enoughBenchmarks || needsRecordGender}
              onClick={onContinue}
              className="rounded bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              Looks right, continue
            </button>
            {!enoughBenchmarks && (
              <span className="text-sm text-gray-600">Enter at least two times.</span>
            )}
            {enoughBenchmarks && needsRecordGender && (
              <span className="text-sm text-gray-600">Choose KOM or QOM.</span>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Step 2: the Search Area; searching it finishes onboarding. */
function SearchStep({ onSearched }: { onSearched: (results: Results) => void }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Where do you run?</h1>
      <SearchAreaForm initial={null} submitLabel="Find my targets" onSearched={onSearched} />
      <div className="mt-6">
        <OsmAttribution />
      </div>
    </>
  );
}

/** Step 3: the crawl's progress, with targets appearing as the poll finds them. */
function TargetsStep({ initial }: { initial: Results }) {
  const [results, setResults] = useState(initial);
  const [failedPolls, setFailedPolls] = useState(0);
  const polling = shouldPoll(results);

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAreaApi.results(controller.signal).then(setResults, () => {
        // A failed poll keeps what it has and tries again later.
        if (!controller.signal.aborted) setFailedPolls((n) => n + 1);
      });
    }, RESULTS_POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [results, polling, failedPolls]);

  const { progress, budget } = results;
  const runsShare =
    progress && progress.runsTotal > 0 ? progress.runsChecked / progress.runsTotal : 1;

  return (
    <>
      <h1 className="text-2xl font-bold">
        {results.pending ? 'Finding your targets…' : 'Your targets are ready'}
      </h1>
      <div
        role="progressbar"
        aria-label="Runs checked"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((results.pending ? runsShare : 1) * 100)}
        className="mt-4 h-2 w-full overflow-hidden rounded bg-gray-200"
      >
        <div
          className="h-full bg-orange-600 transition-all"
          style={{ width: `${(results.pending ? runsShare : 1) * 100}%` }}
        />
      </div>
      <div role="status" className="mt-2 space-y-1 text-sm text-gray-600">
        <p>
          {!progress
            ? 'Checking your runs…'
            : progress.runsTotal === 0
              ? `None of your runs pass through here · ${progress.segmentsTotal} Segments found.`
              : `${progress.runsChecked} of ~${progress.runsTotal} runs checked · ${progress.segmentsTotal} Segments found.`}
          {results.pending && !budget.continuesTomorrow && ' You can leave; this keeps going.'}
        </p>
        {budget.continuesTomorrow && (
          <p>You’ve used today’s Strava budget, so checking the rest continues tomorrow.</p>
        )}
      </div>

      <ResultsSection
        title="Your targets"
        rows={results.targets}
        now={new Date()}
        empty={
          <p className="mt-2 text-sm text-gray-600">
            {results.pending
              ? 'None yet: your Segments are still being checked.'
              : 'None in this Search Area yet. The Results page can search a bigger radius.'}
          </p>
        }
      />
      <Link
        to="/results"
        className="mt-6 inline-block rounded bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700"
      >
        See all results
      </Link>
    </>
  );
}

/**
 * The first-run wizard: 1. Your fitness → 2. Where you run → 3. Your targets. A Runner isn't
 * onboarded until step 2's search, so leaving before then starts them here again.
 */
export function WizardPage() {
  const auth = useAuth();
  const me = auth.status === 'signed-in' ? auth.me : null;
  // Decided on arrival: finishing step 2 marks the Runner onboarded, but step 3 still follows.
  const [alreadyOnboarded] = useState(me?.onboarded ?? false);
  const [step, setStep] = useState<Step>(1);
  const [results, setResults] = useState<Results | null>(null);

  if (!me) return null;
  if (alreadyOnboarded) return <Navigate to="/results" replace />;

  return (
    <>
      <StepBar step={step} />
      {step === 1 && (
        <FitnessStep
          me={me}
          onRecordGender={(recordGender) => auth.updateMe({ recordGender })}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <SearchStep
          onSearched={(searched) => {
            auth.updateMe({ onboarded: true });
            setResults(searched);
            setStep(3);
          }}
        />
      )}
      {step === 3 && results && <TargetsStep initial={results} />}
    </>
  );
}
