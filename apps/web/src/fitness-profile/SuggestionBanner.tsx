import { BENCHMARK_DISTANCES, type SuggestionAction, type SuggestionSummary } from '@mykom/shared';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useSuggestions } from './suggestion';

// en-GB's short month is "Sept"; the banner says "27 Sep".
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' });

function dayOf(iso: string) {
  const date = new Date(iso);
  return `${date.getDate()} ${monthFormat.format(date)}`;
}

/** "Your 10K on 27 Sep suggests VDOT 70.1 → 71.3" */
export function suggestionText({ vdot, appliedVdot, source }: SuggestionSummary): string {
  const distance = source && BENCHMARK_DISTANCES.find((d) => d.id === source.benchmark)?.label;
  const from = source
    ? `Your ${distance ?? 'run'} on ${dayOf(source.startDate)} suggests`
    : 'Your runs suggest';
  const change =
    appliedVdot === null ? vdot.toFixed(1) : `${appliedVdot.toFixed(1)} → ${vdot.toFixed(1)}`;
  return `${from} VDOT ${change}`;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'failed'; action: SuggestionAction['action'] }
  /** Shown on the page it happened on, until the Runner moves to another. */
  | { kind: 'applied'; vdot: number; locationKey: string };

/**
 * A slim banner under the nav while a Fitness Profile suggestion is pending: Apply (in place),
 * Review (the Fitness Profile page, which shows the suggested values) and × (dismiss).
 */
export function SuggestionBanner() {
  const { suggestion, resolve } = useSuggestions();
  const { pathname, key: locationKey } = useLocation();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function act(action: SuggestionAction['action'], vdot: number) {
    setState({ kind: 'busy' });
    try {
      await resolve(action);
      setState(action === 'apply' ? { kind: 'applied', vdot, locationKey } : { kind: 'idle' });
    } catch {
      setState({ kind: 'failed', action });
    }
  }

  if (state.kind === 'applied' && state.locationKey === locationKey) {
    return (
      <Bar>
        <p role="status" className="py-1">
          Applied: your Fitness Profile is now VDOT {state.vdot.toFixed(1)}.
        </p>
      </Bar>
    );
  }
  if (!suggestion) return null;

  const busy = state.kind === 'busy';
  const button = 'rounded px-2 py-0.5 text-sm font-medium whitespace-nowrap disabled:opacity-60';
  return (
    <Bar>
      <section
        aria-label="Fitness Profile suggestion"
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <p className="py-1">{suggestionText(suggestion)}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => act('apply', suggestion.vdot)}
            disabled={busy}
            className={`${button} bg-orange-600 text-white hover:bg-orange-700`}
          >
            Apply
          </button>
          {pathname !== '/fitness-profile' && (
            <Link
              to="/fitness-profile"
              className={`${button} border border-orange-600 text-orange-700 hover:bg-orange-100`}
            >
              Review
            </Link>
          )}
          <button
            type="button"
            onClick={() => act('dismiss', suggestion.vdot)}
            disabled={busy}
            aria-label="Dismiss suggestion"
            title="Dismiss"
            className={`${button} text-lg leading-none text-gray-600 hover:bg-orange-100 hover:text-gray-900`}
          >
            ×
          </button>
        </div>
        {state.kind === 'failed' && (
          <p role="alert" className="w-full text-red-700">
            Couldn’t {state.action} the suggestion. Please try again.
          </p>
        )}
      </section>
    </Bar>
  );
}

function Bar({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-orange-200 bg-orange-50 text-sm text-orange-950">
      <div className="mx-auto max-w-3xl px-4 py-1">{children}</div>
    </div>
  );
}
