// The Nominatim client: the single place place/postcode searches go through.
// Follows the OSMF usage policy (https://operations.osmfoundation.org/policies/nominatim/):
// server-side only, at most 1 request per second, an identifying User-Agent, results cached,
// and no autocomplete (the web app searches on submit).
import type { GeocodeResult } from '@mykom/shared';
import { createThrottle, type Throttle } from './throttle.js';

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

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

/** Where search results are cached, keyed by normalised query. */
export type GeocodeCache = {
  get(query: string): Promise<GeocodeResult[] | undefined>;
  set(query: string, results: GeocodeResult[]): Promise<void>;
};

export type NominatimClientOptions = {
  /** Names the app and a contact, as the usage policy requires. */
  userAgent: string;
  cache: GeocodeCache;
  fetch?: typeof fetch;
  /** Shared by every search. Pass one in only to test with a different interval. */
  throttle?: Throttle;
};

export type NominatimClient = ReturnType<typeof createNominatimClient>;

/** Trims, collapses whitespace and lowercases, so trivially different searches share a cache entry. */
export function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function createNominatimClient({
  userAgent,
  cache,
  fetch: fetchFn = globalThis.fetch,
  throttle = createThrottle(NOMINATIM_INTERVAL_MS),
}: NominatimClientOptions) {
  async function fetchResults(query: string): Promise<GeocodeResult[]> {
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.search = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: String(NOMINATIM_RESULT_LIMIT),
    }).toString();
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
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GeocodeError('Nominatim sent an unreadable response', res.status);
    }
    if (!Array.isArray(body)) {
      throw new GeocodeError('Nominatim sent an unexpected response', res.status);
    }
    return body.flatMap(toGeocodeResult);
  }

  return {
    /** Places matching a name or postcode, best match first. Throws GeocodeError on failure. */
    async search(query: string): Promise<GeocodeResult[]> {
      const key = normaliseQuery(query);
      const cached = await cache.get(key);
      if (cached) return cached;
      const results = await throttle(async () => {
        // An identical search may have been answered while this one waited its turn.
        return (await cache.get(key)) ?? (await fetchResults(key));
      });
      await cache.set(key, results);
      return results;
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
