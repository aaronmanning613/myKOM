import type { SuggestionSummary } from './fitness-profile.js';

/** What `GET /api/me` returns: the signed-in Runner. */
export type Me = {
  id: number;
  firstName: string;
  avatarUrl: string | null;
  /** Whether they have finished the first-run wizard's Search Area step. */
  onboarded: boolean;
  /** A pending Fitness Profile suggestion, for the banner. */
  suggestion: SuggestionSummary | null;
};
