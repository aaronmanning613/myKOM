import type { GeocodeResult } from './geocode.js';

/**
 * Where the Runner's IP address places them: a coarse, city-level guess used when browser
 * geolocation isn't available, so the Runner should confirm it before it becomes their
 * Search Area centre.
 */
export type IpLocation = GeocodeResult & {
  /** How far off the guess may be, in km (MaxMind's accuracy radius). */
  accuracyRadiusKm: number | null;
};

/**
 * What `GET /api/locate-ip` returns. `available: false` when the lookup can't help:
 * `disabled` (the fallback is off, as it always is in production), `no_database` (the
 * GeoLite2 City database isn't installed) or `not_found` (the address isn't in it, e.g. a
 * private or loopback address in development).
 */
export type LocateIpResponse =
  | { available: true; location: IpLocation }
  | { available: false; reason: 'disabled' | 'no_database' | 'not_found' };
