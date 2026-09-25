// Stubs `fetch` with canned API responses, keyed by "METHOD /path".
import { vi } from 'vitest';
import type { Me } from '../auth/AuthContext';

type Handler = () => Response | Promise<Response>;

export const testRunner: Me = {
  id: 1,
  firstName: 'Paula',
  avatarUrl: 'https://example.com/paula.jpg',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Unlisted routes respond 404. The health route answers OK unless overridden. */
export function stubApi(routes: Record<string, Handler>) {
  const all: Record<string, Handler> = {
    'GET /api/health': () => json({ ok: true, db: 'up' }),
    ...routes,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handler = all[`${init?.method ?? 'GET'} ${String(input)}`];
    return handler ? handler() : json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const signedIn = (me: Me = testRunner) => ({ 'GET /api/me': () => json(me) });

export const signedOut = () => ({ 'GET /api/me': () => json({ error: 'signed_out' }, 401) });
