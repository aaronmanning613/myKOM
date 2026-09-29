import type { SuggestionSummary } from './fitness-profile.js';
import type { RecordGender } from './target-record.js';

/** What `GET /api/me` returns: the signed-in Runner. */
export type Me = {
  id: number;
  firstName: string;
  avatarUrl: string | null;
  /** Strava's `sex`; null when unset, so the wizard asks for `recordGender`. */
  sex: 'M' | 'F' | null;
  /** KOM or QOM as the Runner chose it; only used when `sex` is null. */
  recordGender: RecordGender | null;
  /** Whether they have finished the first-run wizard's Search Area step. */
  onboarded: boolean;
  /** A pending Fitness Profile suggestion, for the banner. */
  suggestion: SuggestionSummary | null;
};
