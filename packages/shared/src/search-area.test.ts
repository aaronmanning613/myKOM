import { describe, expect, it } from 'vitest';
import { isSearchRadiusKm, SEARCH_RADII_KM } from './search-area.js';

describe('SEARCH_RADII_KM', () => {
  it('is the placeholder set, smallest first', () => {
    expect(SEARCH_RADII_KM).toEqual([5, 10, 25, 50]);
  });
});

describe('isSearchRadiusKm', () => {
  it.each(SEARCH_RADII_KM)('accepts %i', (radius) => {
    expect(isSearchRadiusKm(radius)).toBe(true);
  });

  it.each([0, 7, 5.5, -5, '5', null, undefined])('rejects %j', (value) => {
    expect(isSearchRadiusKm(value)).toBe(false);
  });
});
