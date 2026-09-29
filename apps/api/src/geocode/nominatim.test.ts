import type { GeocodeResult } from '@mykom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOMINATIM_RESULT_LIMIT,
  NOMINATIM_SEARCH_URL,
  createNominatimClient,
  normaliseQuery,
  type GeocodeCache,
} from './nominatim.js';
import { createThrottle } from './throttle.js';

const USER_AGENT = 'myKOM/0.1 (runner@example.com)';

/** An in-memory cache that records what's asked of it. */
function memoryCache(entries: Record<string, GeocodeResult[]> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get: vi.fn<GeocodeCache['get']>(async (query) => map.get(query)),
    set: vi.fn<GeocodeCache['set']>(async (query, results) => {
      map.set(query, results);
    }),
  };
}

const leedsPlace = {
  place_id: 1,
  lat: '53.7974185',
  lon: '-1.5437941',
  display_name: 'Leeds, West Yorkshire, England, United Kingdom',
  name: 'Leeds',
};

function setup({
  response = () => Response.json([leedsPlace]),
  cache = memoryCache(),
  throttle = createThrottle(0),
}: {
  response?: () => Response | Promise<Response>;
  cache?: ReturnType<typeof memoryCache>;
  throttle?: ReturnType<typeof createThrottle>;
} = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
  const client = createNominatimClient({ userAgent: USER_AGENT, cache, fetch, throttle });
  return { client, fetch, cache };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('normaliseQuery', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normaliseQuery('  LS1   4DY\t')).toBe('ls1 4dy');
  });
});

describe('createNominatimClient', () => {
  it('searches Nominatim with the User-Agent and maps results to { label, lat, lng }', async () => {
    const { client, fetch } = setup();
    await expect(client.search('Leeds')).resolves.toEqual([
      { label: 'Leeds, West Yorkshire, England, United Kingdom', lat: 53.7974185, lng: -1.5437941 },
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    const sent = new URL(String(url));
    expect(`${sent.origin}${sent.pathname}`).toBe(NOMINATIM_SEARCH_URL);
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      q: 'leeds',
      format: 'jsonv2',
      limit: String(NOMINATIM_RESULT_LIMIT),
    });
    expect(new Headers(init?.headers).get('User-Agent')).toBe(USER_AGENT);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps Nominatim’s order and skips malformed places', async () => {
    const { client } = setup({
      response: () =>
        Response.json([
          { lat: '53.96', lon: '-1.08', display_name: '  York  ' },
          { lat: 'not a number', lon: '-1.08', display_name: 'Bad lat' },
          { lat: '91', lon: '0', display_name: 'Off the globe' },
          { lat: 53.9, lon: -1.1, display_name: 'Numbers, not strings' },
          { lat: '53.9', lon: '-1.1', display_name: '' },
          { lat: '53.9', lon: '-1.1' },
          null,
          'nonsense',
          { lat: '51.5', lon: '-0.12', display_name: 'London' },
        ]),
    });
    await expect(client.search('york')).resolves.toEqual([
      { label: 'York', lat: 53.96, lng: -1.08 },
      { label: 'London', lat: 51.5, lng: -0.12 },
    ]);
  });

  it('returns and caches an empty list when nothing matches', async () => {
    const { client, cache } = setup({ response: () => Response.json([]) });
    await expect(client.search('zzzz')).resolves.toEqual([]);
    expect(cache.set).toHaveBeenCalledWith('zzzz', []);
  });

  it('caches results under the normalised query', async () => {
    const { client, cache } = setup();
    await client.search('  LEEDS ');
    expect(cache.map.get('leeds')).toEqual([
      { label: 'Leeds, West Yorkshire, England, United Kingdom', lat: 53.7974185, lng: -1.5437941 },
    ]);
  });

  it('serves a cache hit without calling fetch', async () => {
    const cached = [{ label: 'Cached Leeds', lat: 1, lng: 2 }];
    const { client, fetch, cache } = setup({ cache: memoryCache({ leeds: cached }) });
    await expect(client.search('Leeds')).resolves.toEqual(cached);
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('fetches a repeated search only once', async () => {
    const { client, fetch } = setup();
    await client.search('Leeds');
    await client.search('leeds');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sends concurrent searches at most once a second', async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ throttle: createThrottle(1000) });
    const searches = Promise.all([client.search('a'), client.search('b'), client.search('c')]);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await searches;
  });

  it("doesn't throttle cache hits", async () => {
    vi.useFakeTimers();
    const cached = [{ label: 'Cached', lat: 1, lng: 2 }];
    const { client, fetch } = setup({
      cache: memoryCache({ cached }),
      throttle: createThrottle(1000),
    });
    await client.search('fresh');
    await expect(client.search('cached')).resolves.toEqual(cached);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('uses a result cached while the search waited its turn', async () => {
    vi.useFakeTimers();
    const { client, fetch } = setup({ throttle: createThrottle(1000) });
    const searches = Promise.all([client.search('Leeds'), client.search('leeds')]);
    await vi.advanceTimersByTimeAsync(1000);
    const [first, second] = await searches;
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['a non-2xx response', () => new Response('busy', { status: 503 }), /503/],
    ['an unreadable body', () => new Response('<html>', { status: 200 }), /unreadable/],
    ['a non-array body', () => Response.json({ error: 'nope' }), /unexpected/],
  ])('throws a GeocodeError on %s and caches nothing', async (_name, response, message) => {
    const { client, cache } = setup({ response });
    await expect(client.search('Leeds')).rejects.toThrow(message);
    await expect(client.search('Leeds')).rejects.toMatchObject({ name: 'GeocodeError' });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('throws a GeocodeError when the request fails', async () => {
    const { client } = setup({
      response: () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(client.search('Leeds')).rejects.toMatchObject({
      name: 'GeocodeError',
      message: expect.stringMatching(/fetch failed/),
    });
  });
});
