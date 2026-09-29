import type { Prediction } from './predict.js';
import type { SearchArea } from './search-area.js';
import type { RecordGender } from './target-record.js';

/** One Segment in a results list. Never carries the record holder's name or photo. */
export type ResultRow = {
  segmentId: number;
  name: string;
  /** Metres. */
  distance: number;
  /** As a fraction (0.032 is 3.2%). */
  averageGrade: number;
  kmFromCentre: number;
  /** Impressiveness. */
  athleteCount: number;
  /** The Target Record, in seconds. */
  record: number;
  /** The Predicted Time (unrounded seconds) with its confidence and reason; null with none. */
  predicted: Prediction | null;
  /** The Runner's Segment PB in seconds; null when they've never run it. */
  pb: number | null;
  held: boolean;
  implausible: boolean;
  /** ISO 8601: when the record was last read from Strava, for its age. */
  recordCheckedAt: string;
};

/** The Search Area's crawl: "N of ~M Segments checked". */
export type SearchProgress = {
  /** `running` while runs or Segment details are still to come. */
  status: 'running' | 'done';
  runsChecked: number;
  /** About how many runs the crawl plans (it may stop early). */
  runsTotal: number;
  /** Known Segments found so far in the area that have details. */
  segmentsChecked: number;
  /** Known Segments found so far in the area. */
  segmentsTotal: number;
  /** New Known Segments this crawl's runs added. */
  segmentsFound: number;
};

/** What the Strava budget means for the search's background work. */
export type ResultsBudget = {
  /** The "continues tomorrow" message: the daily budget is used up. */
  continuesTomorrow: boolean;
  /** ISO 8601: when paused work resumes; null when it isn't paused. */
  pausedUntil: string | null;
};

/** What `POST /api/search` (and `GET /api/results`) return for the saved Search Area. */
export type Results = {
  searchArea: SearchArea;
  recordGender: RecordGender;
  targets: ResultRow[];
  nearestMisses: ResultRow[];
  suspicious: ResultRow[];
  /** The N in "N of M Known Segments are Achievable". */
  achievableCount: number;
  /** The M: Known Segments in the area that have details. */
  knownCount: number;
  /** At least two usable Benchmarks, so there are Predicted Times at all. */
  enoughBenchmarks: boolean;
  /** Null before the area's first search. */
  progress: SearchProgress | null;
  /** Work for the area is still pending, so the page should poll. */
  pending: boolean;
  budget: ResultsBudget;
};
