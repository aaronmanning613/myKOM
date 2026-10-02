// The Search Area map's place in the form: a same-height placeholder while the Leaflet chunk
// loads, then the map, with its hint underneath. The form never waits for it.
import type { LatLng } from '@mykom/shared';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { MAP_HEIGHT_CLASSES } from '../map/map-config';

const SearchAreaMap = lazy(() => import('./SearchAreaMap'));

/** Where the centre came from: the map refits for anything but a pin dropped on the map. */
export type CentreSource = 'map' | 'elsewhere';

const boxClasses = `${MAP_HEIGHT_CLASSES} flex w-full items-center justify-center rounded border border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-500`;

/** If the map's chunk fails to load, says so in its place: the rest of the form still works. */
class MapLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? (
      // TODO(decision): the PRD doesn't word this; the place search still chooses a centre.
      <div className={boxClasses}>
        The map couldn’t load. Search for a place or use your location instead.
      </div>
    ) : (
      this.props.children
    );
  }
}

export function SearchAreaMapPanel({
  centre,
  radiusKm,
  source,
  onPick,
}: {
  centre: LatLng | null;
  radiusKm: number;
  source: CentreSource;
  /** A point the Runner dropped or dragged the pin to. */
  onPick: (point: LatLng) => void;
}) {
  return (
    <div>
      <MapLoadBoundary>
        <Suspense fallback={<div className={boxClasses}>Loading the map…</div>}>
          {/* `isolate` keeps Leaflet's z-indexes below the header's menus. */}
          <section aria-label="Search Area map" className="isolate">
            <SearchAreaMap centre={centre} radiusKm={radiusKm} source={source} onPick={onPick} />
          </section>
        </Suspense>
      </MapLoadBoundary>
      <p className="mt-1 text-xs text-gray-600">
        Tap or click the map to drop the pin, then drag it to fine-tune.
      </p>
    </div>
  );
}
