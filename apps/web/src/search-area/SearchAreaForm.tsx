import {
  DEFAULT_SEARCH_RADIUS_KM,
  SEARCH_RADII_KM,
  SLOW_SEARCH_RADIUS_KM,
  type GeocodeResult,
  type Results,
  type SearchArea,
  type SearchRadiusKm,
} from '@mykom/shared';
import { useState, type FormEvent } from 'react';
import { searchAreaApi } from './api';
import { PlacePicker } from './PlacePicker';
import { SearchAreaMapPanel, type CentreSource } from './SearchAreaMapPanel';

/**
 * The Search Area form: a centre (place search or "Use my location") and a radius. Submitting
 * saves the Search Area and searches it (`POST /api/search`), then hands over the Results.
 * With `withMap`, a map shows the centre and radius, and a place search chooses its first match.
 */
export function SearchAreaForm({
  initial,
  submitLabel,
  onSearched,
  withMap = false,
}: {
  /** The saved Search Area, if any, to start from. */
  initial: SearchArea | null;
  submitLabel: string;
  onSearched: (results: Results) => void;
  withMap?: boolean;
}) {
  const [centre, setCentre] = useState<GeocodeResult | null>(
    initial && { label: initial.label, lat: initial.lat, lng: initial.lng },
  );
  const [centreSource, setCentreSource] = useState<CentreSource>('elsewhere');
  const [radiusKm, setRadiusKm] = useState<SearchRadiusKm>(
    initial?.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM,
  );
  const [state, setState] = useState<'idle' | 'searching' | 'failed'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!centre) return;
    setState('searching');
    try {
      const results = await searchAreaApi.search({ ...centre, radiusKm });
      onSearched(results);
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="search-area-centre" className="space-y-4">
        <h2 id="search-area-centre" className="text-lg font-semibold">
          Centre
        </h2>
        <PlacePicker
          id="search-area"
          label="Place or postcode"
          chosen={centre}
          onChoose={(place) => {
            setCentre(place);
            setCentreSource('elsewhere');
            setState('idle');
          }}
          withMyLocation
          chooseFirstResult={withMap}
        />
        {withMap && (
          <SearchAreaMapPanel centre={centre} radiusKm={radiusKm} source={centreSource} />
        )}
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
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
                  name="search-radius"
                  value={radius}
                  checked={radiusKm === radius}
                  onChange={() => {
                    setRadiusKm(radius);
                    setState('idle');
                  }}
                  aria-describedby={radius === SLOW_SEARCH_RADIUS_KM ? 'slow-radius' : undefined}
                  className="accent-orange-600"
                />
                {radius} km
                {radius === SLOW_SEARCH_RADIUS_KM && (
                  <span aria-hidden="true" className="text-xs text-gray-500">
                    (slower)
                  </span>
                )}
              </label>
            ))}
          </div>
          <p id="slow-radius" className="mt-2 text-sm text-gray-600">
            {SLOW_SEARCH_RADIUS_KM} km is slower, and uses more of the daily budget.
          </p>
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
            disabled={!centre || state === 'searching'}
            className="rounded bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {state === 'searching' ? 'Searching your Known Segments…' : submitLabel}
          </button>
          {state === 'failed' && (
            <p role="alert" className="text-sm text-red-700">
              Couldn’t search your Search Area. Please try again.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
