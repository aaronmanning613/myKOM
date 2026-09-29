import { describe, expect, it } from 'vitest';
import { boundingBoxOf, decodePolyline, encodePolyline } from './polyline.js';

describe('decodePolyline', () => {
  it("decodes Google's reference example", () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('gives no points for an empty string and ignores a truncated tail', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(decodePolyline('_p~iF~ps|U_ulL')).toEqual([{ lat: 38.5, lng: -120.2 }]);
  });
});

describe('encodePolyline', () => {
  it('round-trips through decodePolyline at 5 decimal places', () => {
    const points = [
      { lat: 43.63971, lng: -79.42358 },
      { lat: 43.64172, lng: -79.42841 },
      { lat: -33.85, lng: 151.2 },
    ];
    expect(encodePolyline(points)).toBe(encodePolyline(decodePolyline(encodePolyline(points))));
    expect(decodePolyline(encodePolyline(points))).toEqual(points);
    expect(encodePolyline([{ lat: 38.5, lng: -120.2 }])).toBe('_p~iF~ps|U');
  });
});

describe('boundingBoxOf', () => {
  it('spans every point, and is null with none', () => {
    expect(
      boundingBoxOf([
        { lat: 1, lng: 5 },
        { lat: -2, lng: 7 },
        { lat: 0, lng: -3 },
      ]),
    ).toEqual({ minLat: -2, minLng: -3, maxLat: 1, maxLng: 7 });
    expect(boundingBoxOf([])).toBeNull();
  });
});
