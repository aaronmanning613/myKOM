import {
  DEFAULT_MAPPED_AREA_RADIUS_KM,
  MAPPED_AREA_RADII_KM,
  type GeocodeResult,
  type MappedArea,
  type MappedAreaRadiusKm,
} from '@mykom/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mappedAreasApi } from './api';
import { PlacePicker } from './PlacePicker';

/**
 * How often the list refreshes while a Mapped Area is still running. The work happens in the
 * background tick (every few minutes), so there's no need to poll faster.
 */
export const MAPPED_AREAS_POLL_MS = 30_000;

type ListState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; mappedAreas: MappedArea[] };

/** The share of a Mapped Area done, 0-100. */
function percentDone({ progress }: MappedArea): number {
  return progress.status === 'done' ? 100 : Math.floor(progress.coverage * 100);
}

function progressText({ progress }: MappedArea): string {
  const segments = `${progress.segmentsTotal} Known Segment${progress.segmentsTotal === 1 ? '' : 's'}`;
  return progress.status === 'done'
    ? `Done · ${segments}`
    : `${progress.runsChecked} of ~${progress.runsTotal} runs checked · ${segments}`;
}

/** "Map a whole area in the background": start a Mapped Area, and list them with progress. */
export function MappedAreas() {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [place, setPlace] = useState<GeocodeResult | null>(null);
  const [radiusKm, setRadiusKm] = useState<MappedAreaRadiusKm>(DEFAULT_MAPPED_AREA_RADIUS_KM);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const { mappedAreas } = await mappedAreasApi.list(signal);
      setList({ kind: 'ready', mappedAreas });
    } catch {
      if (!signal?.aborted)
        setList((current) => (current.kind === 'ready' ? current : { kind: 'failed' }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const running =
    list.kind === 'ready' && list.mappedAreas.some((area) => area.progress.status === 'running');
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const timer = setInterval(() => void reload(controller.signal), MAPPED_AREAS_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [running, reload]);

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!place) return;
    setStarting(true);
    setError(null);
    try {
      const created = await mappedAreasApi.create({ ...place, radiusKm });
      setList((current) => ({
        kind: 'ready',
        mappedAreas: [created, ...(current.kind === 'ready' ? current.mappedAreas : [])],
      }));
      setPlace(null);
    } catch {
      setError('Couldn’t start mapping that area. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  async function handleRemove(area: MappedArea) {
    setError(null);
    try {
      await mappedAreasApi.remove(area.id);
      setList((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', mappedAreas: current.mappedAreas.filter((a) => a.id !== area.id) }
          : current,
      );
    } catch {
      setError(`Couldn’t remove ${area.label}. Please try again.`);
    }
  }

  return (
    <section aria-labelledby="mapped-areas" className="space-y-4">
      <h2 id="mapped-areas" className="text-lg font-semibold">
        Map a whole area in the background
      </h2>
      <p className="text-gray-700">
        myKOM fills in a Mapped Area bit by bit with spare Strava budget, over days if it needs to,
        so any Search Area inside it is ready straight away. Your searches always come first.
      </p>

      <PlacePicker
        id="mapped-area"
        label="Place to map"
        chosen={place}
        onChoose={(next) => {
          setPlace(next);
          setError(null);
        }}
      />

      <form onSubmit={handleStart} className="space-y-4">
        <fieldset>
          <legend className="font-medium">Mapped Area radius</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {MAPPED_AREA_RADII_KM.map((radius) => (
              <label
                key={radius}
                className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1 has-checked:border-orange-600 has-checked:bg-orange-50"
              >
                <input
                  type="radio"
                  name="mapped-area-radius"
                  value={radius}
                  checked={radiusKm === radius}
                  onChange={() => setRadiusKm(radius)}
                  className="accent-orange-600"
                />
                {radius} km
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-gray-700" data-testid="mapped-area-place">
          {place ? (
            <>
              Area to map: <strong className="break-words">{place.label}</strong>
            </>
          ) : (
            'Search for a place to map.'
          )}
        </p>
        <button
          type="submit"
          disabled={!place || starting}
          className="rounded border border-orange-600 px-4 py-2 font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-60"
        >
          {starting ? 'Starting…' : 'Start mapping'}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {list.kind === 'loading' && <p className="text-gray-500">Loading your Mapped Areas…</p>}
      {list.kind === 'failed' && (
        <p role="alert" className="text-sm text-red-700">
          Couldn’t load your Mapped Areas. Reload the page to try again.
        </p>
      )}
      {list.kind === 'ready' && list.mappedAreas.length > 0 && (
        <ul aria-label="Mapped Areas" className="divide-y divide-gray-200 border-y border-gray-200">
          {list.mappedAreas.map((area) => (
            <li key={area.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words">
                  <strong>{area.label}</strong>{' '}
                  <span className="text-gray-600">· {area.radiusKm} km</span>
                </p>
                <div
                  role="progressbar"
                  aria-label={`Mapping ${area.label}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percentDone(area)}
                  className="h-2 overflow-hidden rounded bg-gray-200"
                >
                  <div
                    className="h-full bg-orange-500"
                    style={{ width: `${percentDone(area)}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600">{progressText(area)}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(area)}
                aria-label={`Remove ${area.label}`}
                className="rounded border border-gray-300 px-3 py-1 text-sm font-medium hover:bg-gray-100"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
