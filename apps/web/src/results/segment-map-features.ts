// What the Segment map draws, decided without Leaflet: the Search Area circle and one feature per
// Segment in Your targets and Nearest misses. Suspicious records aren't suggestions, so they're
// left off.
import {
  boundingBoxOf,
  decodePolyline,
  type BoundingBox,
  type LatLng,
  type ResultRow,
  type Results,
} from '@mykom/shared';
import { circleBounds } from '../map/geometry';
import { routeMarkers, type RouteMarkers } from './route-markers';

export const TARGET_COLOUR = '#ea580c';
export const NEAREST_MISS_COLOUR = '#2563eb';
/** A route's line, in px. */
export const ROUTE_WEIGHT = 4;
/** A route's start marker. */
export const START_COLOUR = '#16a34a';
/** A route's finish marker. */
export const FINISH_COLOUR = '#111827';
/** A route's start and finish circles, in px. */
export const MARKER_RADIUS = 6;
/** A loop's finish, drawn as a ring around its start, in px. */
export const LOOP_RING_RADIUS = 9;
/** The direction arrow's icon, in px square. */
export const ARROW_SIZE = 16;
export { LOOP_THRESHOLD_METRES } from './route-markers';
/** A start-only Segment's circle, in px. */
export const START_RADIUS = 7;
export const START_OUTLINE_COLOUR = '#ffffff';
/** The zoom a start-only Segment is shown at. */
export const START_ZOOM = 16;

export type SegmentMapList = 'targets' | 'nearestMisses';

export const LIST_COLOURS: Record<SegmentMapList, string> = {
  targets: TARGET_COLOUR,
  nearestMisses: NEAREST_MISS_COLOUR,
};

export type SegmentShape =
  { kind: 'route'; points: LatLng[]; markers: RouteMarkers } | { kind: 'start'; point: LatLng };

export type SegmentMapFeature = {
  segmentId: number;
  list: SegmentMapList;
  shape: SegmentShape;
  /** The route's box, or the start point (a box with no area). */
  bounds: BoundingBox;
  row: ResultRow;
};

/**
 * The Segment a "Show on map" button picked. `request` counts the clicks, so clicking the same
 * Segment again refits the map and reopens its popup.
 */
export type SegmentMapSelection = { segmentId: number; request: number };

export type SearchAreaCircle = {
  centre: LatLng;
  radiusMetres: number;
  /** The circle's box, for framing the map. */
  bounds: BoundingBox;
};

export type SegmentMapFeatures = {
  searchArea: SearchAreaCircle;
  segments: SegmentMapFeature[];
};

export function segmentMapFeatures(
  results: Pick<Results, 'searchArea' | 'targets' | 'nearestMisses'>,
): SegmentMapFeatures {
  const segments: SegmentMapFeature[] = [];
  const seen = new Set<number>();
  const lists: [SegmentMapList, ResultRow[]][] = [
    ['targets', results.targets],
    ['nearestMisses', results.nearestMisses],
  ];
  for (const [list, rows] of lists) {
    for (const row of rows) {
      if (seen.has(row.segmentId)) continue;
      seen.add(row.segmentId);
      segments.push(segmentFeature(row, list));
    }
  }
  return { searchArea: searchAreaCircle(results.searchArea), segments };
}

function segmentFeature(row: ResultRow, list: SegmentMapList): SegmentMapFeature {
  const points = routePoints(row.polyline);
  const shape: SegmentShape =
    points === null
      ? { kind: 'start', point: row.start }
      : { kind: 'route', points, markers: routeMarkers(points) };
  const bounds = boundingBoxOf(points ?? [row.start]) as BoundingBox;
  return { segmentId: row.segmentId, list, shape, bounds, row };
}

/** The decoded route, or null when it isn't stored, has under 2 points or doesn't decode. */
function routePoints(polyline: string | null): LatLng[] | null {
  if (polyline === null) return null;
  const points = decodePolyline(polyline);
  if (points.length < 2 || !points.every(isOnEarth)) return null;
  return points;
}

function isOnEarth({ lat, lng }: LatLng): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

function searchAreaCircle(area: Results['searchArea']): SearchAreaCircle {
  const centre = { lat: area.lat, lng: area.lng };
  const radiusMetres = area.radiusKm * 1000;
  return { centre, radiusMetres, bounds: circleBounds(centre, radiusMetres) };
}
