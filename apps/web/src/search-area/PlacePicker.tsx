import type { GeocodeResult, IpLocation } from '@mykom/shared';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, searchAreaApi } from './api';

/** How long to wait for the browser's location before giving up on it. */
export const GEOLOCATION_TIMEOUT_MS = 10_000;

// TODO(decision): a browser location has no place name; reverse geocoding could add one.
export const MY_LOCATION_LABEL = 'My location';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; query: string; results: GeocodeResult[] }
  | { kind: 'failed'; message: string };

type LocateState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'confirm-ip'; location: IpLocation }
  | { kind: 'ip-rejected' }
  | { kind: 'failed' };

/** The browser's position, rejecting on denial, timeout or no Geolocation API. */
function browserPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      reject,
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 5 * 60_000 },
    );
  });
}

function geocodeErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.status === 503
    ? 'Place search isn’t available right now.'
    : 'Place search failed. Please try again.';
}

const buttonClass =
  'rounded border border-gray-300 px-3 py-1 font-medium hover:bg-gray-100 disabled:opacity-60';

/**
 * Finds a place: search a name or postcode, then pick a match (Nominatim has no
 * autocomplete). With `withMyLocation`, also "Use my location", falling back to the IP
 * lookup (after the Runner confirms it) when the browser can't say and the server offers it.
 * With `chooseFirstResult`, a search with matches chooses the first at once (the others can
 * still be picked).
 */
export function PlacePicker({
  id,
  label,
  chosen,
  onChoose,
  withMyLocation = false,
  chooseFirstResult = false,
}: {
  /** Unique on the page: prefixes the element ids. */
  id: string;
  label: string;
  chosen: GeocodeResult | null;
  onChoose: (place: GeocodeResult) => void;
  withMyLocation?: boolean;
  chooseFirstResult?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [locate, setLocate] = useState<LocateState>({ kind: 'idle' });
  const queryInput = useRef<HTMLInputElement>(null);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (q === '') return;
    setSearch({ kind: 'searching' });
    try {
      const { results } = await searchAreaApi.geocode(q);
      setSearch({ kind: 'results', query: q, results });
      if (chooseFirstResult && results[0]) onChoose(results[0]);
    } catch (error) {
      setSearch({ kind: 'failed', message: geocodeErrorMessage(error) });
    }
  }

  async function handleUseMyLocation() {
    setLocate({ kind: 'locating' });
    try {
      const position = await browserPosition();
      onChoose({ label: MY_LOCATION_LABEL, ...position });
      setLocate({ kind: 'idle' });
      return;
    } catch {
      // Denied, timed out or unsupported: the IP lookup is the fallback, where it's offered.
    }
    try {
      const body = await searchAreaApi.locateIp();
      setLocate(
        body.available ? { kind: 'confirm-ip', location: body.location } : { kind: 'failed' },
      );
    } catch {
      setLocate({ kind: 'failed' });
    }
  }

  function confirmIpLocation(location: IpLocation) {
    onChoose({ label: location.label, lat: location.lat, lng: location.lng });
    setLocate({ kind: 'idle' });
  }

  function rejectIpLocation() {
    setLocate({ kind: 'ip-rejected' });
    queryInput.current?.focus();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} role="search" className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-query`} className="w-full font-medium">
          {label}
        </label>
        <input
          id={`${id}-query`}
          ref={queryInput}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1"
        />
        <button
          type="submit"
          disabled={search.kind === 'searching' || query.trim() === ''}
          className={buttonClass}
        >
          {search.kind === 'searching' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {search.kind === 'failed' && (
        <p role="alert" className="text-sm text-red-700">
          {search.message}
        </p>
      )}
      {search.kind === 'results' && search.results.length === 0 && (
        <p className="text-sm text-gray-700">No places found for “{search.query}”.</p>
      )}
      {search.kind === 'results' && search.results.length > 0 && (
        <ul aria-label="Places found" className="divide-y divide-gray-200 border-y border-gray-200">
          {search.results.map((result) => {
            const isChosen =
              chosen?.lat === result.lat &&
              chosen.lng === result.lng &&
              chosen.label === result.label;
            return (
              <li key={`${result.lat},${result.lng},${result.label}`}>
                <button
                  type="button"
                  onClick={() => onChoose(result)}
                  aria-pressed={isChosen}
                  className={`w-full px-2 py-2 text-left break-words hover:bg-gray-100 ${
                    isChosen ? 'bg-orange-50 font-medium' : ''
                  }`}
                >
                  {result.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {withMyLocation && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={locate.kind === 'locating'}
            className={buttonClass}
          >
            {locate.kind === 'locating' ? 'Finding your location…' : 'Use my location'}
          </button>
          {locate.kind === 'confirm-ip' && (
            <div
              role="group"
              aria-labelledby={`${id}-ip-question`}
              className="rounded border border-amber-300 bg-amber-50 p-3"
            >
              <p id={`${id}-ip-question`}>
                We couldn’t get your exact location, but you seem to be near{' '}
                <strong>{locate.location.label}</strong>. Is this right?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => confirmIpLocation(locate.location)}
                  className="rounded bg-orange-600 px-3 py-1 font-medium text-white hover:bg-orange-700"
                >
                  Yes, use this
                </button>
                <button
                  type="button"
                  onClick={rejectIpLocation}
                  className="rounded border border-gray-300 bg-white px-3 py-1 font-medium hover:bg-gray-100"
                >
                  No
                </button>
              </div>
            </div>
          )}
          {locate.kind === 'ip-rejected' && (
            <p className="text-sm text-gray-700">Search for your place or postcode instead.</p>
          )}
          {locate.kind === 'failed' && (
            <p role="alert" className="text-sm text-red-700">
              Couldn’t find your location. Search for your place or postcode instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Nominatim's usage policy asks for this wherever its results are shown. */
export function OsmAttribution() {
  return (
    <p className="text-xs text-gray-500">
      Place search by Nominatim. Data ©{' '}
      <a
        href="https://www.openstreetmap.org/copyright"
        className="underline"
        target="_blank"
        rel="noreferrer"
      >
        OpenStreetMap contributors
      </a>
      .
    </p>
  );
}
