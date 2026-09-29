import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_RADIUS_KM,
  isSearchRadiusKm,
  SEARCH_RADII_KM,
  SLOW_SEARCH_RADIUS_KM,
} from './search-area.js';

describe('SEARCH_RADII_KM', () => {
  it('is 1, 2, 5 and 10 km, smallest first, defaulting to 5', () => {
    expect(SEARCH_RADII_KM).toEqual([1, 2, 5, 10]);
    expect(DEFAULT_SEARCH_RADIUS_KM).toBe(5);
    expect(SLOW_SEARCH_RADIUS_KM).toBe(10);
  });
});

describe('isSearchRadiusKm', () => {
  it.each(SEARCH_RADII_KM)('accepts %i', (radius) => {
    expect(isSearchRadiusKm(radius)).toBe(true);
  });

  it.each([0, 7, 25, 50, 5.5, -5, '5', null, undefined])('rejects %j', (value) => {
    expect(isSearchRadiusKm(value)).toBe(false);
  });
});
