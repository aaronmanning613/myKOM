// The Segment map's place on the Results page: a same-height placeholder while the Leaflet chunk
// loads, then the map, with its legend underneath. The lists never wait for it.
import type { Results } from '@mykom/shared';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { MAP_HEIGHT_CLASSES } from '../map/map-config';
import {
  FINISH_COLOUR,
  NEAREST_MISS_COLOUR,
  START_COLOUR,
  TARGET_COLOUR,
  type SegmentMapSelection,
} from './segment-map-features';

const SegmentMap = lazy(() => import('./SegmentMap'));

/** No map when there's nothing to draw and nothing pending: the empty state covers that. */
export const showsSegmentMap = (results: Results) =>
  results.pending || results.targets.length + results.nearestMisses.length > 0;

export function SegmentMapPanel({
  results,
  selection = null,
  onPopupClose,
}: {
  /** What to draw: the rows the lists are showing, not every row (see ResultsView). */
  results: Results;
  /** The Segment "Show on map" picked: the map scrolls into view, fits it and opens its popup. */
  selection?: SegmentMapSelection | null;
  onPopupClose?: (segmentId: number) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection) panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selection]);

  return (
    <div ref={panel} className="mt-4">
      <Suspense
        fallback={
          <div
            className={`${MAP_HEIGHT_CLASSES} flex w-full items-center justify-center rounded border border-gray-200 bg-gray-50 text-sm text-gray-500`}
          >
            Loading the map…
          </div>
        }
      >
        {/* `isolate` keeps Leaflet's z-indexes below the header's menus. The data attributes
            are a test seam: what the map was handed, without reaching into Leaflet. */}
        <section
          aria-label="Segment map"
          className="isolate"
          data-segment-count={results.targets.length + results.nearestMisses.length}
          data-selected-segment={selection?.segmentId}
        >
          <SegmentMap results={results} selection={selection} onPopupClose={onPopupClose} />
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
        Nearest misses ·{' '}
        <span aria-hidden="true" style={{ color: START_COLOUR }}>
          ●
        </span>{' '}
        start{' '}
        <span aria-hidden="true" style={{ color: FINISH_COLOUR }}>
          ●
        </span>{' '}
        finish · a dot alone is a Segment’s start only
      </p>
    </div>
  );
}
