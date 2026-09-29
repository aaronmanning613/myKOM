// Stubs `fetch` with canned API responses, keyed by "METHOD /path".
import { vi } from 'vitest';
import type { Me } from '../auth/AuthContext';

type Handler = (init?: RequestInit) => Response | Promise<Response>;

export const testRunner: Me = {
  id: 1,
  firstName: 'Paula',
  avatarUrl: 'https://example.com/paula.jpg',
  onboarded: true,
  suggestion: null,
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Unlisted routes respond 404. Unless overridden, the health route answers OK, the
 * Fitness Profile is empty and there's no Search Area or Mapped Area.
 */
export function stubApi(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = {
    'GET /api/health': () => json({ ok: true, db: 'up' }),
    'GET /api/fitness-profile': () =>
      json({ benchmarks: [], generation: null, suggestion: null, resyncedAt: null }),
    'GET /api/search-area': () => json({ searchArea: null }),
    'GET /api/mapped-areas': () => json({ mappedAreas: [] }),
    ...routes,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handler = all[`${init?.method ?? 'GET'} ${String(input)}`];
    return handler ? handler(init) : json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const signedIn = (me: Me = testRunner) => ({ 'GET /api/me': () => json(me) });

export const signedOut = () => ({ 'GET /api/me': () => json({ error: 'signed_out' }, 401) });
