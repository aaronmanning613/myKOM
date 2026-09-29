// Requests to the Fitness Profile endpoints, each answering with the whole FitnessProfile.
import type {
  BenchmarkTime,
  FitnessProfile,
  FitnessProfileUpdate,
  SuggestionAction,
} from '@mykom/shared';

function isFitnessProfile(value: unknown): value is FitnessProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).benchmarks)
  );
}

async function request(url: string, init?: RequestInit): Promise<FitnessProfile> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const body: unknown = await response.json();
  if (!isFitnessProfile(body)) throw new Error('Unexpected Fitness Profile response');
  return body;
}

function send(method: 'PUT' | 'POST', url: string, body?: unknown): Promise<FitnessProfile> {
  return request(
    url,
    body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
}

export const fitnessProfileApi = {
  load: (signal?: AbortSignal) => request('/api/fitness-profile', { signal }),
  save: (update: FitnessProfileUpdate) => send('PUT', '/api/fitness-profile', update),
  updateAll: (from: BenchmarkTime) => send('POST', '/api/fitness-profile/update-all', from),
  reset: () => send('POST', '/api/fitness-profile/reset'),
  regenerate: () => send('POST', '/api/fitness-profile/regenerate'),
  resync: () => send('POST', '/api/activities/resync'),
  resolveSuggestion: (action: SuggestionAction['action']) =>
    send('POST', '/api/fitness-profile/suggestion', { action } satisfies SuggestionAction),
};
