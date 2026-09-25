/**
 * The radii a Runner can pick for their Search Area, in km. The single place to change
 * the set.
 */
// TODO(decision): a placeholder set until the ranking decisions settle what's useful.
export const SEARCH_RADII_KM = [5, 10, 25, 50] as const;

export type SearchRadiusKm = (typeof SEARCH_RADII_KM)[number];

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

/** What `GET` and `PUT /api/search-area` return: null until the Runner saves one. */
export type SearchAreaResponse = {
  searchArea: SearchArea | null;
};

/** The body of `PUT /api/search-area`: replaces the Runner's Search Area. */
export type SearchAreaUpdate = SearchArea;
