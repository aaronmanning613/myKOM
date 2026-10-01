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

export const TARGET_COLOUR = '#ea580c';
export const NEAREST_MISS_COLOUR = '#2563eb';
export const SEARCH_AREA_COLOUR = '#6b7280';
export const SEARCH_AREA_DASH = '6 6';
/** A route's line, in px. */
export const ROUTE_WEIGHT = 4;
/** The small filled circle at a route's start, in px. */
export const ROUTE_START_RADIUS = 4;
/** A start-only Segment's circle, in px. */
export const START_RADIUS = 7;
export const START_OUTLINE_COLOUR = '#ffffff';
/** The zoom a start-only Segment is shown at. */
export const START_ZOOM = 16;

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_MAX_ZOOM = 19;
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type SegmentMapList = 'targets' | 'nearestMisses';

export const LIST_COLOURS: Record<SegmentMapList, string> = {
  targets: TARGET_COLOUR,
  nearestMisses: NEAREST_MISS_COLOUR,
};

export type SegmentShape = { kind: 'route'; points: LatLng[] } | { kind: 'start'; point: LatLng };

export type SegmentMapFeature = {
  segmentId: number;
  list: SegmentMapList;
  shape: SegmentShape;
  /** The route's box, or the start point (a box with no area). */
  bounds: BoundingBox;
  row: ResultRow;
};

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

const EARTH_RADIUS_METRES = 6_371_000;

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
    points === null ? { kind: 'start', point: row.start } : { kind: 'route', points };
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
  const radiusMetres = area.radiusKm * 1000;
  const dLat = (radiusMetres / EARTH_RADIUS_METRES) * (180 / Math.PI);
  const dLng = dLat / Math.cos((area.lat * Math.PI) / 180);
  return {
    centre: { lat: area.lat, lng: area.lng },
    radiusMetres,
    bounds: {
      minLat: area.lat - dLat,
      minLng: area.lng - dLng,
      maxLat: area.lat + dLat,
      maxLng: area.lng + dLng,
    },
  };
}
