// The Segment map's place on the Results page: a same-height placeholder while the Leaflet chunk
// loads, then the map, with its legend underneath. The lists never wait for it.
import type { Results } from '@mykom/shared';
import { lazy, Suspense } from 'react';
import { MAP_HEIGHT_CLASSES, NEAREST_MISS_COLOUR, TARGET_COLOUR } from './segment-map-features';

const SegmentMap = lazy(() => import('./SegmentMap'));

/** No map when there's nothing to draw and nothing pending: the empty state covers that. */
export const showsSegmentMap = (results: Results) =>
  results.pending || results.targets.length + results.nearestMisses.length > 0;

export function SegmentMapPanel({ results }: { results: Results }) {
  return (
    <div className="mt-4">
      <Suspense
        fallback={
          <div
            className={`${MAP_HEIGHT_CLASSES} flex w-full items-center justify-center rounded border border-gray-200 bg-gray-50 text-sm text-gray-500`}
          >
            Loading the map…
          </div>
        }
      >
        {/* `isolate` keeps Leaflet's z-indexes below the header's menus. */}
        <section aria-label="Segment map" className="isolate">
          <SegmentMap results={results} />
        </section>
      </Suspense>
      <p className="mt-1 text-xs text-gray-600">
        <span aria-hidden="true" style={{ color: TARGET_COLOUR }}>
          ●
        </span>{' '}
        Your targets{' '}
        <span aria-hidden="true" style={{ color: NEAREST_MISS_COLOUR }}>
          ●
        </span>{' '}
        Nearest misses · a line is the whole Segment, a dot is its start
      </p>
    </div>
  );
}
