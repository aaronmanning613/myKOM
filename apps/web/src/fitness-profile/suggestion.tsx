// The pending Fitness Profile suggestion, shared by the app-wide banner and the Fitness Profile
// page. It starts as `GET /api/me` reported it and follows whatever the Runner does after that.
import type { FitnessProfile, SuggestionAction, SuggestionSummary } from '@mykom/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth, type Me } from '../auth/AuthContext';
import { fitnessProfileApi } from './api';

export type Suggestions = {
  suggestion: SuggestionSummary | null;
  /** Applies or dismisses the suggestion and answers with the Fitness Profile afterwards. */
  resolve(action: SuggestionAction['action']): Promise<FitnessProfile>;
  /** Tells the banner what a freshly loaded or changed Fitness Profile says is pending. */
  follow(profile: FitnessProfile): void;
  /** Goes up each time the banner changes the Fitness Profile, so a page showing it reloads. */
  revision: number;
};

/** The suggestion as the banner describes it, from a whole Fitness Profile. */
export function summaryOf(profile: FitnessProfile): SuggestionSummary | null {
  if (!profile.suggestion) return null;
  return {
    vdot: profile.suggestion.vdot,
    appliedVdot: profile.generation?.vdot ?? null,
    source: profile.suggestion.sources[0] ?? null,
  };
}

const SuggestionContext = createContext<Suggestions | null>(null);

export function SuggestionProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const me = auth.status === 'signed-in' ? auth.me : null;
  // What the Runner has changed since `me` was loaded; a different Runner starts afresh.
  const [local, setLocal] = useState<{ me: Me; suggestion: SuggestionSummary | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const suggestion = me && local?.me === me ? local.suggestion : (me?.suggestion ?? null);

  const follow = useCallback(
    (profile: FitnessProfile) => {
      if (me) setLocal({ me, suggestion: summaryOf(profile) });
    },
    [me],
  );

  const resolve = useCallback(
    async (action: SuggestionAction['action']) => {
      const profile = await fitnessProfileApi.resolveSuggestion(action);
      follow(profile);
      setRevision((r) => r + 1);
      return profile;
    },
    [follow],
  );

  const value = useMemo(
    () => ({ suggestion, resolve, follow, revision }),
    [suggestion, resolve, follow, revision],
  );
  return <SuggestionContext value={value}>{children}</SuggestionContext>;
}

export function useSuggestions(): Suggestions {
  const suggestions = useContext(SuggestionContext);
  if (!suggestions) throw new Error('useSuggestions must be used inside a SuggestionProvider');
  return suggestions;
}
