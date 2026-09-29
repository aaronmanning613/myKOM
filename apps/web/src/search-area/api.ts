// Requests behind the Search Area page: the saved area, searching, place search, the IP
// fallback and Mapped Areas.
import type {
  GeocodeResponse,
  LocateIpResponse,
  MappedArea,
  MappedAreaCreate,
  MappedAreasResponse,
  Results,
  SearchAreaResponse,
  SearchAreaUpdate,
} from '@mykom/shared';

/** A request that got a response other than 2xx. */
export class ApiError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} responded ${status}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request<T>(
  url: string,
  isValid: (body: Record<string, unknown>) => boolean,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new ApiError(url, response.status);
  const body: unknown = await response.json();
  if (!isObject(body) || !isValid(body)) throw new Error(`Unexpected response from ${url}`);
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const searchAreaApi = {
  load: (signal?: AbortSignal) =>
    request<SearchAreaResponse>('/api/search-area', (body) => 'searchArea' in body, { signal }),
  /** Saves the Search Area and searches it (the first burst can take a few seconds). */
  search: (update: SearchAreaUpdate) =>
    request<Results>('/api/search', (body) => 'searchArea' in body, post(update)),
  geocode: (q: string) =>
    request<GeocodeResponse>(`/api/geocode?${new URLSearchParams({ q })}`, (body) =>
      Array.isArray(body.results),
    ),
  locateIp: () =>
    request<LocateIpResponse>('/api/locate-ip', (body) => typeof body.available === 'boolean'),
};

export const mappedAreasApi = {
  list: (signal?: AbortSignal) =>
    request<MappedAreasResponse>('/api/mapped-areas', (body) => Array.isArray(body.mappedAreas), {
      signal,
    }),
  create: (area: MappedAreaCreate) =>
    request<MappedArea>('/api/mapped-areas', (body) => typeof body.id === 'number', post(area)),
  remove: async (id: number) => {
    const url = `/api/mapped-areas/${id}`;
    const response = await fetch(url, { method: 'DELETE' });
    // Already gone counts as removed.
    if (!response.ok && response.status !== 404) throw new ApiError(url, response.status);
  },
};
