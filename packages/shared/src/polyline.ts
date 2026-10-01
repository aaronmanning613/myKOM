// Google's encoded polyline format (precision 5), as Strava sends `summary_polyline` and a
// Segment's `map.polyline`.

export type LatLng = { lat: number; lng: number };

export type BoundingBox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

const PRECISION = 1e5;

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    const dLat = readValue();
    const dLng = readValue();
    if (dLat === undefined || dLng === undefined) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / PRECISION, lng: lng / PRECISION });
  }
  return points;

  function readValue(): number | undefined {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return undefined;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const { lat, lng } of points) {
    const iLat = Math.round(lat * PRECISION);
    const iLng = Math.round(lng * PRECISION);
    out += encodeValue(iLat - prevLat) + encodeValue(iLng - prevLng);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** The points' bounding box, or null when there are none. */
export function boundingBoxOf(points: LatLng[]): BoundingBox | null {
  if (points.length === 0) return null;
  const box = { minLat: Infinity, minLng: Infinity, maxLat: -Infinity, maxLng: -Infinity };
  for (const { lat, lng } of points) {
    box.minLat = Math.min(box.minLat, lat);
    box.minLng = Math.min(box.minLng, lng);
    box.maxLat = Math.max(box.maxLat, lat);
    box.maxLng = Math.max(box.maxLng, lng);
  }
  return box;
}
