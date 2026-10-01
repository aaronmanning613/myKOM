// The Segment map itself, with Leaflet. Loaded lazily (see SegmentMapPanel), so Leaflet and its
// CSS stay out of the main bundle. What to draw is decided by segment-map-features.ts.
import 'leaflet/dist/leaflet.css';
import { formatTime, type Results } from '@mykom/shared';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import {
  Circle,
  CircleMarker,
  FeatureGroup,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { formatDistance, formatGrade, Predicted, StravaLink } from './ResultsSection';
import {
  LIST_COLOURS,
  MAP_HEIGHT_CLASSES,
  ROUTE_START_RADIUS,
  ROUTE_WEIGHT,
  SEARCH_AREA_COLOUR,
  SEARCH_AREA_DASH,
  segmentMapFeatures,
  START_OUTLINE_COLOUR,
  START_RADIUS,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  TILE_URL,
  type SearchAreaCircle,
  type SegmentMapFeature,
} from './segment-map-features';
import type { BoundingBox, LatLng } from '@mykom/shared';

/** A little room around the Search Area circle, so its edge isn't on the map's border. */
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [12, 12] };

const toLeaflet = ({ lat, lng }: LatLng): L.LatLngTuple => [lat, lng];
const toLeafletBounds = (box: BoundingBox): L.LatLngBoundsExpression => [
  [box.minLat, box.minLng],
  [box.maxLat, box.maxLng],
];

/**
 * Fits the map to the Search Area on first render and whenever its centre or radius changes,
 * but never on a results poll, so the Runner's own pan and zoom survive refining.
 */
function FrameSearchArea({ searchArea }: { searchArea: SearchAreaCircle }) {
  const map = useMap();
  const { centre, radiusMetres } = searchArea;
  useEffect(() => {
    map.fitBounds(toLeafletBounds(searchArea.bounds), FIT_OPTIONS);
    // Only the Search Area itself refits: a poll hands over a new but equal object.
  }, [map, centre.lat, centre.lng, radiusMetres]);
  return null;
}

function SegmentPopup({ feature }: { feature: SegmentMapFeature }) {
  const { row, list, shape } = feature;
  return (
    <div className="space-y-0.5 text-sm text-gray-900">
      <div className="font-semibold">
        {row.held && (
          <span role="img" aria-label="Held" className="mr-1">
            👑
          </span>
        )}
        {row.name}
      </div>
      <div>{list === 'targets' ? 'Your target' : 'Nearest miss'}</div>
      <div className="text-gray-600">
        {formatDistance(row.distance)} · {formatGrade(row.averageGrade)}
      </div>
      <div className="tabular-nums">
        Record {formatTime(row.record)} · Predicted <Predicted predicted={row.predicted} /> · Your
        PB {row.pb === null ? '—' : formatTime(row.pb)}
      </div>
      {shape.kind === 'start' && <div className="text-gray-600">Start point only</div>}
      <div>
        <StravaLink segmentId={row.segmentId} name={row.name} />
      </div>
    </div>
  );
}

/** One Segment: a route with a dot at its start, or a bigger dot on its start alone. */
function SegmentLayer({ feature }: { feature: SegmentMapFeature }) {
  const colour = LIST_COLOURS[feature.list];
  const id = `segment-map-${feature.segmentId}`;
  const { shape } = feature;
  return (
    <FeatureGroup>
      <Popup>
        <SegmentPopup feature={feature} />
      </Popup>
      {shape.kind === 'route' ? (
        <>
          <Polyline
            positions={shape.points.map(toLeaflet)}
            pathOptions={{
              color: colour,
              weight: ROUTE_WEIGHT,
              className: `${id} segment-map-route`,
            }}
          />
          <CircleMarker
            center={toLeaflet(shape.points[0]!)}
            radius={ROUTE_START_RADIUS}
            pathOptions={{
              color: colour,
              fillColor: colour,
              fillOpacity: 1,
              weight: 1,
              className: `${id} segment-map-route-start`,
            }}
          />
        </>
      ) : (
        <CircleMarker
          center={toLeaflet(shape.point)}
          radius={START_RADIUS}
          pathOptions={{
            color: START_OUTLINE_COLOUR,
            weight: 2,
            fillColor: colour,
            fillOpacity: 1,
            className: `${id} segment-map-start`,
          }}
        />
      )}
    </FeatureGroup>
  );
}

export default function SegmentMap({
  results,
}: {
  results: Pick<Results, 'searchArea' | 'targets' | 'nearestMisses'>;
}) {
  const { searchArea, segments } = useMemo(() => segmentMapFeatures(results), [results]);
  return (
    <MapContainer
      bounds={toLeafletBounds(searchArea.bounds)}
      boundsOptions={FIT_OPTIONS}
      maxZoom={TILE_MAX_ZOOM}
      // The page scrolls past the map: no wheel zoom, and no one-finger drag on touch devices.
      scrollWheelZoom={false}
      dragging={!L.Browser.mobile}
      className={`${MAP_HEIGHT_CLASSES} w-full rounded border border-gray-200`}
    >
      <TileLayer url={TILE_URL} maxZoom={TILE_MAX_ZOOM} attribution={TILE_ATTRIBUTION} />
      <FrameSearchArea searchArea={searchArea} />
      <Circle
        center={toLeaflet(searchArea.centre)}
        radius={searchArea.radiusMetres}
        interactive={false}
        pathOptions={{
          color: SEARCH_AREA_COLOUR,
          weight: 2,
          dashArray: SEARCH_AREA_DASH,
          fill: false,
        }}
      />
      {segments.map((feature) => (
        <SegmentLayer key={feature.segmentId} feature={feature} />
      ))}
    </MapContainer>
  );
}
