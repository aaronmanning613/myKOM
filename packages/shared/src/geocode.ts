/** The longest place or postcode search `GET /api/geocode` accepts. */
export const MAX_GEOCODE_QUERY_LENGTH = 200;

/** A place found by searching a name or postcode: a candidate Search Area centre. */
export type GeocodeResult = {
  label: string;
  lat: number;
  lng: number;
};

/** What `GET /api/geocode?q=` returns: best match first, empty when nothing matched. */
export type GeocodeResponse = {
  results: GeocodeResult[];
};
