import type { SearchArea } from '@mykom/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { searchAreaApi } from '../search-area/api';
import { MappedAreas } from '../search-area/MappedAreas';
import { OsmAttribution } from '../search-area/PlacePicker';
import { SearchAreaForm } from '../search-area/SearchAreaForm';

type LoadState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; saved: SearchArea | null };

export function SearchAreaPage() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    searchAreaApi.load(controller.signal).then(
      ({ searchArea }) => setLoad({ kind: 'ready', saved: searchArea }),
      () => {
        if (!controller.signal.aborted) setLoad({ kind: 'failed' });
      },
    );
    return () => controller.abort();
  }, []);

  return (
    <>
      <h1 className="text-2xl font-bold">Search Area</h1>
      <p className="mt-2 text-gray-700">
        Choose where to look for your Known Segments: a centre point and a radius around it.
      </p>

      {load.kind === 'loading' && <p className="mt-6 text-gray-500">Loading your Search Area…</p>}
      {load.kind === 'failed' && (
        <p role="alert" className="mt-6 text-red-700">
          Couldn’t load your Search Area. Reload the page to try again.
        </p>
      )}
      {load.kind === 'ready' && (
        <div className="mt-6 max-w-xl space-y-8">
          <p data-testid="saved-search-area" className="text-gray-700">
            {load.saved ? (
              <>
                Your Search Area: <strong>{load.saved.radiusKm} km</strong> around{' '}
                <strong className="break-words">{load.saved.label}</strong>
              </>
            ) : (
              'You haven’t set a Search Area yet.'
            )}
          </p>

          <SearchAreaForm
            initial={load.saved}
            submitLabel="Save and see results"
            onSearched={() => void navigate('/results')}
          />

          <hr className="border-gray-200" />

          <MappedAreas />

          <OsmAttribution />
        </div>
      )}
    </>
  );
}
