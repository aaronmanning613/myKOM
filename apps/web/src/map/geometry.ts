// Map maths shared by every map: a circle's box, and converting to Leaflet's coordinates.
// Leaflet is imported for its types only, so the main bundle can import this.
import type { BoundingBox, LatLng } from '@mykom/shared';
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet';

const EARTH_RADIUS_METRES = 6_371_000;

/** The box around a circle on the map, for framing it. */
export function circleBounds(centre: LatLng, radiusMetres: number): BoundingBox {
  const dLat = (radiusMetres / EARTH_RADIUS_METRES) * (180 / Math.PI);
  const dLng = dLat / Math.cos((centre.lat * Math.PI) / 180);
  return {
    minLat: centre.lat - dLat,
    minLng: centre.lng - dLng,
    maxLat: centre.lat + dLat,
    maxLng: centre.lng + dLng,
  };
}

export const toLeaflet = ({ lat, lng }: LatLng): LatLngTuple => [lat, lng];

export const toLeafletBounds = (box: BoundingBox): LatLngBoundsExpression => [
  [box.minLat, box.minLng],
  [box.maxLat, box.maxLng],
];
