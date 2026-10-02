import {
  RESULTS_POLL_SECONDS,
  SEARCH_RADII_KM,
  type Results,
  type SearchRadiusKm,
} from '@mykom/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { INITIAL_SHOWN, nextShown, type ShownCounts } from '../results/paging';
import { ResultsSection } from '../results/ResultsSection';
import type { SegmentMapSelection } from '../results/segment-map-features';
import { SegmentMapPanel, showsSegmentMap } from '../results/SegmentMapPanel';
import { ApiError, searchAreaApi } from '../search-area/api';

export const RESULTS_POLL_MS = RESULTS_POLL_SECONDS * 1000;

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'no-search-area' }
  | { kind: 'ready'; results: Results };

/** Keeps polling while the search's work is pending, unless it waits for tomorrow's budget. */
export const shouldPoll = (results: Results) =>
  results.pending && !results.budget.continuesTomorrow;

export function ResultsPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [failedPolls, setFailedPolls] = useState(0);

  // The first load, then a poll every RESULTS_POLL_SECONDS while work is pending. A radius
  // change (searching) cancels any poll in flight.
  const polling = load.kind === 'ready' && shouldPoll(load.results) && !searching;
  const loaded = load.kind !== 'loading';
  useEffect(() => {
    if (loaded && !polling) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        searchAreaApi.results(controller.signal).then(
          (results) => setLoad({ kind: 'ready', results }),
          (error: unknown) => {
            if (controller.signal.aborted) return;
            if (error instanceof ApiError && error.status === 404) {
              setLoad({ kind: 'no-search-area' });
            } else if (!loaded) setLoad({ kind: 'failed' });
            // A failed poll keeps the list it has and tries again later.
            else setFailedPolls((n) => n + 1);
          },
        );
      },
      loaded ? RESULTS_POLL_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `load` itself, so each poll's response schedules the next one.
  }, [load, loaded, polling, failedPolls]);

  const changeRadius = async (results: Results, radiusKm: SearchRadiusKm) => {
    setSearching(true);
    setSearchFailed(false);
    try {
      setLoad({
        kind: 'ready',
        results: await searchAreaApi.search({ ...results.searchArea, radiusKm }),
      });
    } catch {
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      {load.kind !== 'ready' && <h1 className="text-2xl font-bold">Results</h1>}
      {load.kind === 'loading' && <p className="mt-6 text-gray-500">Loading your results…</p>}
      {load.kind === 'failed' && (
        <p role="alert" className="mt-6 text-red-700">
          Couldn’t load your results. Reload the page to try again.
        </p>
      )}
      {load.kind === 'no-search-area' && (
        <p className="mt-6 text-gray-700">
          You haven’t set a Search Area yet.{' '}
          <Link to="/search-area" className="font-medium text-orange-700 underline">
            Choose where to look
          </Link>{' '}
          to see the Segments whose Target Record you could take.
        </p>
      )}
      {load.kind === 'ready' && (
        <ResultsView
          results={load.results}
          searching={searching}
          searchFailed={searchFailed}
          onRadius={(radiusKm) => void changeRadius(load.results, radiusKm)}
        />
      )}
    </>
  );
}

function ResultsView({
  results,
  searching,
  searchFailed,
  onRadius,
}: {
  results: Results;
  searching: boolean;
  searchFailed: boolean;
  onRadius: (radiusKm: SearchRadiusKm) => void;
}) {
  const { searchArea, progress, budget } = results;
  const now = new Date();
  const biggerRadius = SEARCH_RADII_KM.find((r) => r > searchArea.radiusKm);

  // How many rows each list shows. A poll never resets it; a new Search Area does.
  const areaKey = `${searchArea.lat},${searchArea.lng},${searchArea.radiusKm}`;
  const [paging, setPaging] = useState({ areaKey, shown: INITIAL_SHOWN });
  const shown = paging.areaKey === areaKey ? paging.shown : INITIAL_SHOWN;
  const showMore = (list: keyof ShownCounts) =>
    setPaging({
      areaKey,
      shown: { ...shown, [list]: nextShown(results[list].length, shown[list]) },
    });

  // The Segment "Show on map" picked, until its popup closes.
  const [selection, setSelection] = useState<SegmentMapSelection | null>(null);
  const showOnMap = (segmentId: number) =>
    setSelection((current) => ({ segmentId, request: (current?.request ?? 0) + 1 }));
  const clearSelection = (segmentId: number) =>
    setSelection((current) => (current?.segmentId === segmentId ? null : current));
  // A poll that drops the selected Segment clears it (its layer goes, closing its popup).
  const selectedId = selection?.segmentId;
  const selectedOnMap =
    selectedId !== undefined &&
    [...results.targets, ...results.nearestMisses].some((row) => row.segmentId === selectedId);
  useEffect(() => {
    if (selectedId !== undefined && !selectedOnMap) clearSelection(selectedId);
  }, [selectedId, selectedOnMap]);

  const emptyTargets = results.pending ? (
    <p className="mt-2 text-sm text-gray-600">None yet: your Segments are still being checked.</p>
  ) : (
    <div className="mt-2 rounded border border-dashed border-gray-300 p-4 text-sm text-gray-600">
      {biggerRadius ? (
        <>
          No targets within {searchArea.radiusKm} km yet. Try a bigger radius:{' '}
          <button
            type="button"
            disabled={searching}
            onClick={() => onRadius(biggerRadius)}
            className="font-medium text-orange-700 underline disabled:opacity-50"
          >
            search {biggerRadius} km
          </button>
          .
        </>
      ) : (
        <>
          No targets within {searchArea.radiusKm} km.{' '}
          <Link to="/search-area" className="font-medium text-orange-700 underline">
            Try another place
          </Link>
          .
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Results</h1>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <label htmlFor="results-radius" className="text-gray-600">
            Within
          </label>
          <select
            id="results-radius"
            aria-label="Radius"
            className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
            value={searchArea.radiusKm}
            disabled={searching}
            onChange={(e) => onRadius(Number(e.target.value) as SearchRadiusKm)}
          >
            {SEARCH_RADII_KM.map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
          <span className="text-gray-600">of</span>
          <Link
            to="/search-area"
            className="max-w-[16rem] truncate font-medium text-orange-700 underline"
            title={searchArea.label}
          >
            {searchArea.label}
          </Link>
        </div>
      </div>

      <div role="status" className="mt-1 space-y-1 text-sm text-gray-600">
        {searching ? (
          <p>Searching your Known Segments…</p>
        ) : (
          <>
            <p>
              {results.achievableCount} of {results.knownCount} Known Segments are Achievable.
            </p>
            {results.pending && !budget.continuesTomorrow && (
              <p>
                refining:{' '}
                {progress
                  ? `${progress.segmentsChecked} of ~${progress.segmentsTotal} Segments checked`
                  : 'checking your Segments'}
                …
              </p>
            )}
            {budget.continuesTomorrow && (
              <p>
                You’ve used today’s Strava budget, so checking the rest continues tomorrow. The list
                so far is below.
              </p>
            )}
          </>
        )}
      </div>
      {searchFailed && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          Couldn’t change the radius. Try again.
        </p>
      )}

      {!results.enoughBenchmarks && (
        <p className="mt-4 rounded border border-orange-200 bg-orange-50 p-3 text-sm text-gray-800">
          Predicted Times need at least two Benchmarks.{' '}
          <Link to="/fitness-profile" className="font-medium text-orange-700 underline">
            Add them on your Fitness Profile
          </Link>
          .
        </p>
      )}

      {showsSegmentMap(results) && (
        <SegmentMapPanel results={results} selection={selection} onPopupClose={clearSelection} />
      )}

      <ResultsSection
        title="Your targets"
        rows={results.targets}
        now={now}
        empty={emptyTargets}
        onShowOnMap={showOnMap}
        shown={shown.targets}
        onShowMore={() => showMore('targets')}
      />
      {results.nearestMisses.length > 0 && (
        <ResultsSection
          title="Nearest misses"
          subtitle="Not quite in reach yet: the closest to their records."
          rows={results.nearestMisses}
          now={now}
          onShowOnMap={showOnMap}
          shown={shown.nearestMisses}
          onShowMore={() => showMore('nearestMisses')}
        />
      )}
      {results.suspicious.length > 0 && (
        <ResultsSection
          title="Suspicious records"
          subtitle="Records faster than is humanly plausible: probably GPS glitches."
          rows={results.suspicious}
          now={now}
          muted
          shown={shown.suspicious}
          onShowMore={() => showMore('suspicious')}
        />
      )}
    </>
  );
}
