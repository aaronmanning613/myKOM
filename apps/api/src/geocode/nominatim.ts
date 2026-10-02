// The Nominatim client: the single place place/postcode searches go through.
// Follows the OSMF usage policy (https://operations.osmfoundation.org/policies/nominatim/):
// server-side only, at most 1 request per second, an identifying User-Agent, results cached,
// and no autocomplete (the web app searches on submit).
import type { GeocodeResult } from '@mykom/shared';
import { createThrottle, type Throttle } from './throttle.js';

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

/** Street level: the zoom a reverse lookup asks Nominatim for. */
export const NOMINATIM_REVERSE_ZOOM = 16;

/** Reverse lookups round to 4 decimal places (about 11 m), so nearby pins share a cache entry. */
const REVERSE_DECIMALS = 4;

/** Nominatim's limit for the public server: one request per second across the whole app. */
export const NOMINATIM_INTERVAL_MS = 1000;

/** How many candidates a search returns for the Runner to pick from. */
export const NOMINATIM_RESULT_LIMIT = 5;

const REQUEST_TIMEOUT_MS = 10_000;

export class GeocodeError extends Error {
  constructor(
    message: string,
    /** HTTP status from Nominatim, or undefined when the request never got a response. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GeocodeError';
  }
}

/**
 * Where results are cached: searches keyed by normalised query, reverse lookups by
 * reverseCacheKey (stored as a 0- or 1-element list).
 */
export type GeocodeCache = {
  get(query: string): Promise<GeocodeResult[] | undefined>;
  set(query: string, results: GeocodeResult[]): Promise<void>;
};

export type NominatimClientOptions = {
  /** Names the app and a contact, as the usage policy requires. */
  userAgent: string;
  cache: GeocodeCache;
  fetch?: typeof fetch;
  /** Shared by every search and reverse lookup. Pass one in only to test with a different interval. */
  throttle?: Throttle;
};

export type NominatimClient = ReturnType<typeof createNominatimClient>;

/** Trims, collapses whitespace and lowercases, so trivially different searches share a cache entry. */
export function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function roundCoordinate(value: number): number {
  const factor = 10 ** REVERSE_DECIMALS;
  // `+ 0` turns -0 into 0, so the key never reads "-0".
  return Math.round(value * factor) / factor + 0;
}

/**
 * The cache key for a reverse lookup of already-rounded coordinates. The leading tab means it
 * can never collide with a search, because normaliseQuery always trims.
 */
export function reverseCacheKey(lat: number, lng: number): string {
  return `\treverse:${lat},${lng}`;
}

export function createNominatimClient({
  userAgent,
  cache,
  fetch: fetchFn = globalThis.fetch,
  throttle = createThrottle(NOMINATIM_INTERVAL_MS),
}: NominatimClientOptions) {
  /** GETs a Nominatim endpoint and parses its JSON. Throws GeocodeError on failure. */
  async function fetchJson(base: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(base);
    url.search = new URLSearchParams({ ...params, format: 'jsonv2' }).toString();
    let res: Response;
    try {
      res = await fetchFn(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new GeocodeError(`Nominatim request failed: ${(error as Error).message}`);
    }
    if (!res.ok) throw new GeocodeError(`Nominatim responded ${res.status}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new GeocodeError('Nominatim sent an unreadable response', res.status);
    }
  }

  async function fetchResults(query: string): Promise<GeocodeResult[]> {
    const body = await fetchJson(NOMINATIM_SEARCH_URL, {
      q: query,
      limit: String(NOMINATIM_RESULT_LIMIT),
    });
    if (!Array.isArray(body)) throw new GeocodeError('Nominatim sent an unexpected response');
    return body.flatMap(toGeocodeResult);
  }

  async function fetchReverse(lat: number, lng: number): Promise<GeocodeResult[]> {
    const body = await fetchJson(NOMINATIM_REVERSE_URL, {
      lat: String(lat),
      lon: String(lng),
      zoom: String(NOMINATIM_REVERSE_ZOOM),
    });
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new GeocodeError('Nominatim sent an unexpected response');
    }
    // A point with nothing there (e.g. at sea) gets `{ "error": "Unable to geocode" }`.
    if ('error' in body) return [];
    return toGeocodeResult(body);
  }

  /** Serves `key` from the cache, or fetches it in turn with every other Nominatim request. */
  async function cached(key: string, fetchUncached: () => Promise<GeocodeResult[]>) {
    const hit = await cache.get(key);
    if (hit) return hit;
    const results = await throttle(async () => {
      // An identical request may have been answered while this one waited its turn.
      return (await cache.get(key)) ?? (await fetchUncached());
    });
    await cache.set(key, results);
    return results;
  }

  return {
    /** Places matching a name or postcode, best match first. Throws GeocodeError on failure. */
    async search(query: string): Promise<GeocodeResult[]> {
      const key = normaliseQuery(query);
      return cached(key, () => fetchResults(key));
    },
    /**
     * The place at a point (rounded to about 11 m), or null when there's none.
     * Throws GeocodeError on failure.
     */
    async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
      const roundedLat = roundCoordinate(lat);
      const roundedLng = roundCoordinate(lng);
      const [result] = await cached(reverseCacheKey(roundedLat, roundedLng), () =>
        fetchReverse(roundedLat, roundedLng),
      );
      return result ?? null;
    },
  };
}

/** Maps one Nominatim `jsonv2` place to a GeocodeResult, skipping anything malformed. */
function toGeocodeResult(place: unknown): GeocodeResult[] {
  if (typeof place !== 'object' || place === null) return [];
  const { display_name: label, lat, lon } = place as Record<string, unknown>;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (
    typeof label !== 'string' ||
    !label.trim() ||
    typeof lat !== 'string' ||
    typeof lon !== 'string' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return [];
  }
  return [{ label: label.trim(), lat: latitude, lng: longitude }];
}
