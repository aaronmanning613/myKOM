import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** Mirrors the API's `GET /api/me` response: the signed-in Runner. */
export type Me = {
  id: number;
  firstName: string;
  avatarUrl: string | null;
};

export type AuthState =
  | { status: 'loading' }
  /** `disconnected` when the Runner has just disconnected Strava and had their data deleted. */
  | { status: 'signed-out'; disconnected?: boolean }
  | { status: 'signed-in'; me: Me };

export type Auth = AuthState & {
  /** Ends the session. */
  logOut(): Promise<void>;
  /** Revokes myKOM's Strava access and deletes all of the Runner's data. */
  disconnect(): Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

function isMe(value: unknown): value is Me {
  if (typeof value !== 'object' || value === null) return false;
  const { id, firstName, avatarUrl } = value as Record<string, unknown>;
  return (
    typeof id === 'number' &&
    typeof firstName === 'string' &&
    (avatarUrl === null || typeof avatarUrl === 'string')
  );
}

/** The signed-in Runner, or null when signed out. Anything but a valid Runner counts as signed out. */
async function fetchMe(signal: AbortSignal): Promise<Me | null> {
  try {
    const response = await fetch('/api/me', { signal });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isMe(body) ? body : null;
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

async function post(url: string): Promise<void> {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal).then(
      (me) => setState(me ? { status: 'signed-in', me } : { status: 'signed-out' }),
      () => {},
    );
    return () => controller.abort();
  }, []);

  const logOut = useCallback(async () => {
    await post('/api/auth/logout');
    setState({ status: 'signed-out' });
  }, []);

  const disconnect = useCallback(async () => {
    await post('/api/auth/disconnect');
    setState({ status: 'signed-out', disconnected: true });
  }, []);

  const auth = useMemo(() => ({ ...state, logOut, disconnect }), [state, logOut, disconnect]);
  return <AuthContext value={auth}>{children}</AuthContext>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside an AuthProvider');
  return auth;
}
