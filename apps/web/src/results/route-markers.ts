// Where a route's start, finish and direction arrow go, decided without Leaflet.
import { distanceKm, type LatLng } from '@mykom/shared';

/** A route whose start and finish are this close is a loop: its finish is drawn as a ring. */
export const LOOP_THRESHOLD_METRES = 25;

export type RouteMarkers = {
  start: LatLng;
  finish: LatLng;
  loop: boolean;
  /** Halfway along the route by distance, pointing the way it runs (0 = north, clockwise). */
  arrow: { point: LatLng; bearingDegrees: number };
};

/** Markers for a route of at least 2 points. */
export function routeMarkers(points: LatLng[]): RouteMarkers {
  const start = points[0]!;
  const finish = points[points.length - 1]!;
  return {
    start,
    finish,
    loop: metres(start, finish) <= LOOP_THRESHOLD_METRES,
    arrow: halfway(points),
  };
}

function halfway(points: LatLng[]): RouteMarkers['arrow'] {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const length = metres(from, to);
    // A repeated point has no direction, so it can't hold the arrow.
    if (length > 0) legs.push({ from, to, length });
  }
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  if (total === 0) return { point: points[0]!, bearingDegrees: 0 };

  let remaining = total / 2;
  for (const leg of legs) {
    if (remaining <= leg.length) {
      const t = remaining / leg.length;
      return {
        point: {
          lat: leg.from.lat + (leg.to.lat - leg.from.lat) * t,
          lng: leg.from.lng + (leg.to.lng - leg.from.lng) * t,
        },
        bearingDegrees: bearing(leg.from, leg.to),
      };
    }
    remaining -= leg.length;
  }
  // Floating-point rounding can leave a sliver past the last leg.
  const last = legs[legs.length - 1]!;
  return { point: last.to, bearingDegrees: bearing(last.from, last.to) };
}

function metres(a: LatLng, b: LatLng): number {
  return distanceKm(a, b) * 1000;
}

/** The initial great-circle bearing from a to b, in [0, 360). */
function bearing(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}
