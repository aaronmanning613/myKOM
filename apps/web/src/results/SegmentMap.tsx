// The Segment map itself, with Leaflet. Loaded lazily (see SegmentMapPanel), so Leaflet and its
// CSS stay out of the main bundle. What to draw is decided by segment-map-features.ts.
import 'leaflet/dist/leaflet.css';
import { formatTime, type Results } from '@mykom/shared';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import {
  Circle,
  CircleMarker,
  FeatureGroup,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { formatDistance, formatGrade, Predicted, StravaLink } from './ResultsSection';
import {
  ARROW_SIZE,
  FINISH_COLOUR,
  LIST_COLOURS,
  LOOP_RING_RADIUS,
  MAP_HEIGHT_CLASSES,
  MARKER_RADIUS,
  ROUTE_WEIGHT,
  SEARCH_AREA_COLOUR,
  SEARCH_AREA_DASH,
  segmentMapFeatures,
  START_COLOUR,
  START_OUTLINE_COLOUR,
  START_RADIUS,
  START_ZOOM,
  TILE_ATTRIBUTION,
  TILE_MAX_ZOOM,
  TILE_URL,
  type SearchAreaCircle,
  type SegmentMapFeature,
  type SegmentMapSelection,
} from './segment-map-features';
import type { BoundingBox, LatLng } from '@mykom/shared';

/** A little room around the Search Area circle, so its edge isn't on the map's border. */
const FIT_OPTIONS: L.FitBoundsOptions = { padding: [12, 12] };
/**
 * Framing one Segment: no animation, so its popup's own pan (to fit the popup in) starts from
 * where the map ends up.
 */
const SHOW_SEGMENT_OPTIONS: L.FitBoundsOptions = { padding: [24, 24], animate: false };
/**
 * A popup's pan keeps it below the +/− control (top left, about 74 px tall), which would
 * otherwise cover the Segment's name on the 260 px phone map.
 */
const POPUP_PAN_PADDING_TOP_LEFT: L.PointTuple = [5, 80];

/**
 * Panes above the routes' lines (Leaflet's overlay pane, z-index 400) and below its marker pane,
 * so every route's arrow sits over the lines and its finish and start over the arrow.
 */
const ARROW_PANE = 'segmentMapArrows';
const ENDS_PANE = 'segmentMapEnds';

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

/** The start of a Segment: its route's first point, or its stored start. */
const startOf = ({ shape }: SegmentMapFeature) =>
  shape.kind === 'route' ? shape.points[0]! : shape.point;

/**
 * "Show on map": fits the map to the selected Segment (its route, or zoom 16 on its start) and
 * opens its popup. Runs per click, never on a poll.
 */
function ShowSelection({
  selection,
  features,
  layers,
}: {
  selection: SegmentMapSelection | null;
  features: SegmentMapFeature[];
  layers: Map<number, L.FeatureGroup>;
}) {
  const map = useMap();
  const latest = useRef(features);
  latest.current = features;
  useEffect(() => {
    if (!selection) return;
    const feature = latest.current.find((f) => f.segmentId === selection.segmentId);
    const layer = layers.get(selection.segmentId);
    if (!feature || !layer) return;
    if (feature.shape.kind === 'route') {
      map.fitBounds(toLeafletBounds(feature.bounds), SHOW_SEGMENT_OPTIONS);
    } else {
      map.setView(toLeaflet(feature.shape.point), START_ZOOM, { animate: false });
    }
    layer.openPopup(toLeaflet(startOf(feature)));
  }, [map, layers, selection]);
  return null;
}

/** A chevron pointing up (north), in the list colour with a white outline. */
function arrowSvg(colour: string): string {
  const path = 'M3 11 L8 5 L13 11';
  const stroke = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ARROW_SIZE}" height="${ARROW_SIZE}" viewBox="0 0 16 16">` +
    `<path d="${path}" ${stroke} stroke="#ffffff" stroke-width="5"/>` +
    `<path d="${path}" ${stroke} stroke="${colour}" stroke-width="2.5"/>` +
    '</svg>'
  );
}

/**
 * The direction arrow's icon. The rotation is on an inner element: Leaflet positions the icon
 * itself with its own transform.
 */
function arrowIcon(className: string, colour: string, bearingDegrees: number): L.DivIcon {
  return L.divIcon({
    className,
    html:
      `<div class="segment-map-arrow-inner" style="transform: rotate(${bearingDegrees}deg)">` +
      `${arrowSvg(colour)}</div>`,
    iconSize: [ARROW_SIZE, ARROW_SIZE],
    iconAnchor: [ARROW_SIZE / 2, ARROW_SIZE / 2],
  });
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
      {shape.kind === 'route' ? (
        <div className="text-gray-600">Starts at the green dot, finishes at the black one</div>
      ) : (
        <div className="text-gray-600">Start point only</div>
      )}
      <div>
        <StravaLink segmentId={row.segmentId} name={row.name} />
      </div>
    </div>
  );
}

/**
 * One Segment: a route with its direction arrow, finish and start (in that order, bottom to top),
 * or a bigger dot on its start alone.
 */
function SegmentLayer({
  feature,
  layers,
  onPopupClose,
}: {
  feature: SegmentMapFeature;
  layers: Map<number, L.FeatureGroup>;
  onPopupClose: (segmentId: number) => void;
}) {
  const colour = LIST_COLOURS[feature.list];
  const id = `segment-map-${feature.segmentId}`;
  const { segmentId, shape } = feature;
  const markers = shape.kind === 'route' ? shape.markers : null;
  const arrow = useMemo(
    () =>
      markers &&
      arrowIcon(`${id} segment-map-arrow`, colour, Math.round(markers.arrow.bearingDegrees)),
    [id, colour, markers],
  );
  return (
    <FeatureGroup
      ref={(layer) => {
        if (layer) layers.set(segmentId, layer);
        else layers.delete(segmentId);
      }}
      // Also fires when a poll drops the Segment: removing its layer closes its popup.
      eventHandlers={{ popupclose: () => onPopupClose(segmentId) }}
    >
      <Popup autoPanPaddingTopLeft={POPUP_PAN_PADDING_TOP_LEFT}>
        <SegmentPopup feature={feature} />
      </Popup>
      {shape.kind === 'route' && markers && arrow ? (
        <>
          <Polyline
            positions={shape.points.map(toLeaflet)}
            pathOptions={{
              color: colour,
              weight: ROUTE_WEIGHT,
              className: `${id} segment-map-route`,
            }}
          />
          <Marker
            position={toLeaflet(markers.arrow.point)}
            icon={arrow}
            interactive={false}
            keyboard={false}
            pane={ARROW_PANE}
          />
          <CircleMarker
            center={toLeaflet(markers.finish)}
            pane={ENDS_PANE}
            {...(markers.loop
              ? {
                  // A ring around the start, so both stay visible.
                  radius: LOOP_RING_RADIUS,
                  pathOptions: {
                    color: FINISH_COLOUR,
                    weight: 3,
                    fill: false,
                    className: `${id} segment-map-finish`,
                  },
                }
              : {
                  radius: MARKER_RADIUS,
                  pathOptions: {
                    color: START_OUTLINE_COLOUR,
                    weight: 2,
                    fillColor: FINISH_COLOUR,
                    fillOpacity: 1,
                    className: `${id} segment-map-finish`,
                  },
                })}
          />
          <CircleMarker
            center={toLeaflet(markers.start)}
            radius={MARKER_RADIUS}
            pane={ENDS_PANE}
            pathOptions={{
              color: START_OUTLINE_COLOUR,
              weight: 2,
              fillColor: START_COLOUR,
              fillOpacity: 1,
              className: `${id} segment-map-start-marker`,
            }}
          />
        </>
      ) : (
        <CircleMarker
          center={toLeaflet(startOf(feature))}
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
  selection = null,
  onPopupClose = () => {},
}: {
  results: Pick<Results, 'searchArea' | 'targets' | 'nearestMisses'>;
  selection?: SegmentMapSelection | null;
  /** Called with the Segment whose popup just closed. */
  onPopupClose?: (segmentId: number) => void;
}) {
  const { searchArea, segments } = useMemo(() => segmentMapFeatures(results), [results]);
  const layers = useRef(new Map<number, L.FeatureGroup>()).current;
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
      {/* Before the Segments, so the panes exist when their layers are added. */}
      <Pane name={ARROW_PANE} style={{ zIndex: '450' }} />
      <Pane name={ENDS_PANE} style={{ zIndex: '460' }} />
      <Circle
        center={toLeaflet(searchArea.centre)}
        radius={searchArea.radiusMetres}
        interactive={false}
        pathOptions={{
          color: SEARCH_AREA_COLOUR,
          weight: 2,
          dashArray: SEARCH_AREA_DASH,
          fill: false,
          className: 'segment-map-search-area',
        }}
      />
      {segments.map((feature) => (
        <SegmentLayer
          key={feature.segmentId}
          feature={feature}
          layers={layers}
          onPopupClose={onPopupClose}
        />
      ))}
      {/* Last, so the Segments' layers are on the map before it opens a popup. */}
      <ShowSelection selection={selection} features={segments} layers={layers} />
    </MapContainer>
  );
}
