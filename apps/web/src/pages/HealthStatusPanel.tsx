import { useEffect, useState } from 'react';

/** Mirrors the API's `GET /api/health` response. */
export type HealthStatus = {
  ok: boolean;
  db: 'up' | 'down';
};

type State =
  { kind: 'loading' } | { kind: 'loaded'; health: HealthStatus } | { kind: 'unreachable' };

function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== 'object' || value === null) return false;
  const { ok, db } = value as Record<string, unknown>;
  return typeof ok === 'boolean' && (db === 'up' || db === 'down');
}

/** Fetches the health route. A 503 still carries a status body, so only a missing one counts as unreachable. */
async function fetchHealth(signal: AbortSignal): Promise<HealthStatus | null> {
  try {
    const response = await fetch('/api/health', { signal });
    const body: unknown = await response.json();
    return isHealthStatus(body) ? body : null;
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

export function HealthStatusPanel() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(
      (health) => setState(health ? { kind: 'loaded', health } : { kind: 'unreachable' }),
      () => {},
    );
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="health-heading" className="mt-6 rounded border border-gray-200 p-4">
      <h2 id="health-heading" className="font-semibold">
        System status
      </h2>
      {state.kind === 'loading' && <p className="mt-2 text-gray-500">Checking…</p>}
      {state.kind === 'unreachable' && <p className="mt-2 text-red-700">API: unreachable</p>}
      {state.kind === 'loaded' && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>API</dt>
          <dd className={state.health.ok ? 'text-green-700' : 'text-red-700'}>
            {state.health.ok ? 'OK' : 'Degraded'}
          </dd>
          <dt>Database</dt>
          <dd className={state.health.db === 'up' ? 'text-green-700' : 'text-red-700'}>
            {state.health.db === 'up' ? 'Up' : 'Down'}
          </dd>
        </dl>
      )}
    </section>
  );
}
