import {
  DEFAULT_SEARCH_RADIUS_KM,
  SEARCH_RADII_KM,
  type GeocodeResponse,
  type GeocodeResult,
  type IpLocation,
  type LocateIpResponse,
  type Results,
  type SearchArea,
  type SearchAreaResponse,
  type SearchRadiusKm,
  type SearchAreaUpdate,
} from '@mykom/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';

/** How long to wait for the browser's location before falling back to the IP lookup. */
export const GEOLOCATION_TIMEOUT_MS = 10_000;

// TODO(decision): a browser location has no place name; reverse geocoding could add one.
export const MY_LOCATION_LABEL = 'My location';

type Centre = GeocodeResult;

type LoadState = 'loading' | 'failed' | 'ready';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJson<T>(response: Response, isValid: (body: unknown) => boolean): Promise<T> {
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const body: unknown = await response.json();
  if (!isValid(body)) throw new Error('Unexpected response');
  return body as T;
}

const isSearchAreaResponse = (body: unknown) => isObject(body) && 'searchArea' in body;
const isGeocodeResponse = (body: unknown) => isObject(body) && Array.isArray(body.results);
const isLocateIpResponse = (body: unknown) => isObject(body) && typeof body.available === 'boolean';

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

function geocodeErrorMessage(status: number): string {
  return status === 503
    ? 'Place search isn’t available right now.'
    : 'Place search failed. Please try again.';
}

export function SearchAreaPage() {
  const [load, setLoad] = useState<LoadState>('loading');
  const [saved, setSaved] = useState<SearchArea | null>(null);
  const [centre, setCentre] = useState<Centre | null>(null);
  const [radiusKm, setRadiusKm] = useState<SearchRadiusKm>(DEFAULT_SEARCH_RADIUS_KM);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [locate, setLocate] = useState<LocateState>({ kind: 'idle' });
  const [save, setSave] = useState<SaveState>('idle');
  const queryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/search-area', { signal: controller.signal })
      .then((response) => readJson<SearchAreaResponse>(response, isSearchAreaResponse))
      .then(
        ({ searchArea }) => {
          setSaved(searchArea);
          if (searchArea) {
            setCentre({ label: searchArea.label, lat: searchArea.lat, lng: searchArea.lng });
            setRadiusKm(searchArea.radiusKm);
          }
          setLoad('ready');
        },
        () => {
          if (!controller.signal.aborted) setLoad('failed');
        },
      );
    return () => controller.abort();
  }, []);

  function chooseCentre(next: Centre) {
    setCentre(next);
    setSave('idle');
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (q === '') return;
    setSearch({ kind: 'searching' });
    try {
      const response = await fetch(`/api/geocode?${new URLSearchParams({ q })}`);
      if (!response.ok) {
        setSearch({ kind: 'failed', message: geocodeErrorMessage(response.status) });
        return;
      }
      const { results } = await readJson<GeocodeResponse>(response, isGeocodeResponse);
      setSearch({ kind: 'results', query: q, results });
    } catch {
      setSearch({ kind: 'failed', message: geocodeErrorMessage(0) });
    }
  }

  async function handleUseMyLocation() {
    setLocate({ kind: 'locating' });
    try {
      const position = await browserPosition();
      chooseCentre({ label: MY_LOCATION_LABEL, ...position });
      setLocate({ kind: 'idle' });
      return;
    } catch {
      // Denied, timed out or unsupported: IP location is the fallback.
    }
    try {
      const response = await fetch('/api/locate-ip');
      const body = await readJson<LocateIpResponse>(response, isLocateIpResponse);
      setLocate(
        body.available ? { kind: 'confirm-ip', location: body.location } : { kind: 'failed' },
      );
    } catch {
      setLocate({ kind: 'failed' });
    }
  }

  function confirmIpLocation(location: IpLocation) {
    chooseCentre({ label: location.label, lat: location.lat, lng: location.lng });
    setLocate({ kind: 'idle' });
  }

  function rejectIpLocation() {
    setLocate({ kind: 'ip-rejected' });
    queryInput.current?.focus();
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!centre) return;
    const update: SearchAreaUpdate = { ...centre, radiusKm };
    setSave('saving');
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const { searchArea } = await readJson<Results>(response, isSearchAreaResponse);
      setSaved(searchArea);
      setSave('saved');
    } catch {
      setSave('failed');
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold">Search Area</h1>
      <p className="mt-2 text-gray-700">
        Choose where to look for your Known Segments: a centre point and a radius around it.
      </p>

      {load === 'loading' && <p className="mt-6 text-gray-500">Loading your Search Area…</p>}
      {load === 'failed' && (
        <p role="alert" className="mt-6 text-red-700">
          Couldn’t load your Search Area. Reload the page to try again.
        </p>
      )}
      {load === 'ready' && (
        <div className="mt-6 max-w-xl space-y-8">
          <p data-testid="saved-search-area" className="text-gray-700">
            {saved ? (
              <>
                Your Search Area: <strong>{saved.radiusKm} km</strong> around{' '}
                <strong className="break-words">{saved.label}</strong>
              </>
            ) : (
              'You haven’t set a Search Area yet.'
            )}
          </p>

          <section aria-labelledby="find-centre" className="space-y-4">
            <h2 id="find-centre" className="text-lg font-semibold">
              Centre
            </h2>

            <form onSubmit={handleSearch} role="search" className="flex flex-wrap gap-2">
              <label htmlFor="place-query" className="w-full font-medium">
                Place or postcode
              </label>
              <input
                id="place-query"
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
                className="rounded border border-gray-300 px-3 py-1 font-medium hover:bg-gray-100 disabled:opacity-60"
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
              <ul
                aria-label="Places found"
                className="divide-y divide-gray-200 border-y border-gray-200"
              >
                {search.results.map((result) => {
                  const chosen =
                    centre?.lat === result.lat &&
                    centre.lng === result.lng &&
                    centre.label === result.label;
                  return (
                    <li key={`${result.lat},${result.lng},${result.label}`}>
                      <button
                        type="button"
                        onClick={() => chooseCentre(result)}
                        aria-pressed={chosen}
                        className={`w-full px-2 py-2 text-left break-words hover:bg-gray-100 ${
                          chosen ? 'bg-orange-50 font-medium' : ''
                        }`}
                      >
                        {result.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={locate.kind === 'locating'}
                className="rounded border border-gray-300 px-3 py-1 font-medium hover:bg-gray-100 disabled:opacity-60"
              >
                {locate.kind === 'locating' ? 'Finding your location…' : 'Use my location'}
              </button>
              {locate.kind === 'confirm-ip' && (
                <div
                  role="group"
                  aria-labelledby="ip-location-question"
                  className="rounded border border-amber-300 bg-amber-50 p-3"
                >
                  <p id="ip-location-question">
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
          </section>

          <form onSubmit={handleSave} className="space-y-4">
            <fieldset>
              <legend className="text-lg font-semibold">Radius</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {SEARCH_RADII_KM.map((radius) => (
                  <label
                    key={radius}
                    className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1 has-checked:border-orange-600 has-checked:bg-orange-50"
                  >
                    <input
                      type="radio"
                      name="radius"
                      value={radius}
                      checked={radiusKm === radius}
                      onChange={() => {
                        setRadiusKm(radius);
                        setSave('idle');
                      }}
                      className="accent-orange-600"
                    />
                    {radius} km
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="text-gray-700" data-testid="chosen-centre">
              {centre ? (
                <>
                  Centre: <strong className="break-words">{centre.label}</strong>
                </>
              ) : (
                'Search for a place or use your location to choose a centre.'
              )}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!centre || save === 'saving'}
                className="rounded bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-60"
              >
                {save === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <p role="status" className="text-sm text-green-700">
                {save === 'saved' && 'Search Area saved.'}
              </p>
              {save === 'failed' && (
                <p role="alert" className="text-sm text-red-700">
                  Couldn’t save your Search Area. Please try again.
                </p>
              )}
            </div>
          </form>

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
        </div>
      )}
    </>
  );
}
