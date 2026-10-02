// The Search Area map itself, with Leaflet. Loaded lazily (see SearchAreaMapPanel), so Leaflet and
// its CSS stay out of the main bundle.
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '@mykom/shared';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { circleBounds, toLeaflet, toLeafletBounds } from '../map/geometry';
import {
  MAP_HEIGHT_CLASSES,
  SEARCH_AREA_COLOUR,
  SEARCH_AREA_DASH,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  TILE_URL,
} from '../map/map-config';
import type { CentreSource } from './SearchAreaMapPanel';

/** With no centre yet, the whole world. */
const WORLD_CENTRE: L.LatLngTuple = [20, 0];
const WORLD_ZOOM = 2;

/** A little room around the Search Area circle, so its edge isn't on the map's border. */
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [12, 12] };

const PIN_COLOUR = '#ea580c';
const PIN_WIDTH = 28;
const PIN_HEIGHT = 40;

/** An orange teardrop with a white dot, its tip on the centre. */
const pinIcon = L.divIcon({
  className: 'search-area-pin',
  html:
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 28 40">` +
    `<path d="M14 39 C14 39 2 23 2 14 A12 12 0 0 1 26 14 C26 23 14 39 14 39 Z" fill="${PIN_COLOUR}" stroke="#ffffff" stroke-width="2"/>` +
    '<circle cx="14" cy="14" r="5" fill="#ffffff"/>' +
    '</svg>',
  iconSize: [PIN_WIDTH, PIN_HEIGHT],
  iconAnchor: [PIN_WIDTH / 2, PIN_HEIGHT],
});

const radiusMetres = (radiusKm: number) => radiusKm * 1000;

/**
 * Fits the map to the circle when the centre comes from outside the map, or when the radius
 * changes. A centre chosen on the map leaves the view where the Runner put it.
 */
function FrameSearchArea({
  centre,
  radiusKm,
  source,
}: {
  centre: LatLng | null;
  radiusKm: number;
  source: CentreSource;
}) {
  const map = useMap();
  const lat = centre?.lat;
  const lng = centre?.lng;
  // The view the map was created with already frames the first centre.
  const framed = useRef({ lat, lng, radiusKm });
  useEffect(() => {
    const previous = framed.current;
    framed.current = { lat, lng, radiusKm };
    if (lat === undefined || lng === undefined) return;
    const centreChanged = previous.lat !== lat || previous.lng !== lng;
    const radiusChanged = previous.radiusKm !== radiusKm;
    if (radiusChanged || (centreChanged && source === 'elsewhere')) {
      map.fitBounds(
        toLeafletBounds(circleBounds({ lat, lng }, radiusMetres(radiusKm))),
        FIT_OPTIONS,
      );
    }
  }, [map, lat, lng, radiusKm, source]);
  return null;
}

/**
 * A test seam: the map's zoom and visible bounds (Leaflet's "west,south,east,north"), read from
 * Leaflet, on its container.
 */
function ReportView() {
  const map = useMap();
  useEffect(() => {
    const report = () => {
      const { dataset } = map.getContainer();
      dataset.zoom = String(map.getZoom());
      dataset.bounds = map.getBounds().toBBoxString();
    };
    report();
    map.on('zoomend moveend', report);
    return () => {
      map.off('zoomend moveend', report);
    };
  }, [map]);
  return null;
}

/** A click or tap on the map (Leaflet's `click` doesn't fire after a drag) drops the pin there. */
function DropPin({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({
    click: (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });
  return null;
}

/** The pin, draggable, with its Leaflet position on its element as a test seam. */
function Pin({ centre, onPick }: { centre: LatLng; onPick: (point: LatLng) => void }) {
  const marker = useRef<L.Marker>(null);
  useEffect(() => {
    const element = marker.current?.getElement();
    const position = marker.current?.getLatLng();
    if (element && position) {
      element.dataset.lat = String(position.lat);
      element.dataset.lng = String(position.lng);
    }
  }, [centre.lat, centre.lng]);
  return (
    <Marker
      ref={marker}
      position={toLeaflet(centre)}
      icon={pinIcon}
      keyboard={false}
      draggable
      eventHandlers={{
        dragend: () => {
          const position = marker.current?.getLatLng();
          if (position) onPick({ lat: position.lat, lng: position.lng });
        },
      }}
    />
  );
}

export default function SearchAreaMap({
  centre,
  radiusKm,
  source,
  onPick,
}: {
  centre: LatLng | null;
  radiusKm: number;
  source: CentreSource;
  onPick: (point: LatLng) => void;
}) {
  const view = centre
    ? {
        bounds: toLeafletBounds(circleBounds(centre, radiusMetres(radiusKm))),
        boundsOptions: FIT_OPTIONS,
      }
    : { center: WORLD_CENTRE, zoom: WORLD_ZOOM };
  return (
    <MapContainer
      {...view}
      maxZoom={TILE_MAX_ZOOM}
      // The page scrolls past the map, so no wheel zoom. Dragging stays on, even on touch
      // devices: this map is a picker, and the Runner needs to pan it.
      scrollWheelZoom={false}
      className={`${MAP_HEIGHT_CLASSES} w-full rounded border border-gray-200`}
    >
      <TileLayer url={TILE_URL} maxZoom={TILE_MAX_ZOOM} attribution={TILE_ATTRIBUTION} />
      <FrameSearchArea centre={centre} radiusKm={radiusKm} source={source} />
      <ReportView />
      <DropPin onPick={onPick} />
      {centre && (
        <>
          <Circle
            center={toLeaflet(centre)}
            radius={radiusMetres(radiusKm)}
            interactive={false}
            pathOptions={{
              color: SEARCH_AREA_COLOUR,
              weight: 2,
              dashArray: SEARCH_AREA_DASH,
              fill: false,
              className: 'search-area-map-circle',
            }}
          />
          <Pin centre={centre} onPick={onPick} />
        </>
      )}
    </MapContainer>
  );
}
