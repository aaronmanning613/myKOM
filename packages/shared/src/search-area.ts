/**
 * The radii a Runner can pick for their Search Area, in km. The single place to change
 * the set.
 */
export const SEARCH_RADII_KM = [1, 2, 5, 10] as const;

export type SearchRadiusKm = (typeof SEARCH_RADII_KM)[number];

/** The radius picked before the Runner has chosen one. */
export const DEFAULT_SEARCH_RADIUS_KM: SearchRadiusKm = 5;

/** The radius marked "slower, uses more of the daily budget". */
export const SLOW_SEARCH_RADIUS_KM: SearchRadiusKm = 10;

export function isSearchRadiusKm(value: unknown): value is SearchRadiusKm {
  return SEARCH_RADII_KM.some((radius) => radius === value);
}

/** The longest label a Search Area may have (place names from geocoding can be long). */
export const MAX_SEARCH_AREA_LABEL_LENGTH = 300;

/** A centre point plus a radius: narrows the Runner's Known Segments. */
export type SearchArea = {
  /** What the Runner sees, e.g. the place name or postcode they picked. */
  label: string;
  lat: number;
  lng: number;
  radiusKm: SearchRadiusKm;
};

/** What `GET /api/search-area` returns: null until the Runner saves one. */
export type SearchAreaResponse = {
  searchArea: SearchArea | null;
};

/** The body of `POST /api/search`: replaces the Runner's Search Area and searches it. */
export type SearchAreaUpdate = SearchArea;
