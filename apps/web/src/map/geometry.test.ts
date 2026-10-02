import { describe, expect, it } from 'vitest';
import { circleBounds } from './geometry';

describe('circleBounds', () => {
  it('boxes a circle around its centre', () => {
    const bounds = circleBounds({ lat: 45.42, lng: -75.69 }, 2000);
    // 2 km is about 0.018° of latitude, and more degrees of longitude away from the equator.
    expect(bounds.maxLat - 45.42).toBeCloseTo(0.018, 3);
    expect(45.42 - bounds.minLat).toBeCloseTo(0.018, 3);
    expect(bounds.maxLng - -75.69).toBeCloseTo(0.018 / Math.cos((45.42 * Math.PI) / 180), 3);
    expect(-75.69 - bounds.minLng).toBeCloseTo(bounds.maxLng - -75.69, 9);
  });
});
