/**
 * Every tunable from the spec's Tunables table, one named constant each.
 * "Decided" values are fixed by the spec; "starting" values are defaults to tune against real data.
 */

/** Achievable: Predicted Time ≤ Target Record × this. Decided (a fixed 5% margin, not a Runner setting). */
export const ACHIEVABLE_MARGIN = 1.05;

/** Implausible Record: faster than the grade-adjusted world-record time × this. Decided. */
export const IMPLAUSIBLE_FACTOR = 1.05;

/** Nearest misses are shown only when fewer than this many Segments are Achievable. Decided. */
export const NEAREST_MISSES_BELOW_ACHIEVABLE = 5;

/** At most this many Nearest misses. Decided. */
export const MAX_NEAREST_MISSES = 10;

/** Fitness Profile generation uses runs from the last this-many years. Decided. */
export const PROFILE_WINDOW_YEARS = 3;

/** A run counts for Benchmark distance D when its distance is at least this × D. Decided. */
export const PROFILE_BAND_MIN = 0.98;

/** A run counts for Benchmark distance D when its distance is at most this × D. Decided. */
export const PROFILE_BAND_MAX = 1.06;

/** The second-best run's VDOT counts only when it's within this of the best. Decided. */
export const SECOND_RUN_VDOT_GUARD = 8;

/** Extrapolation past the Benchmark range: the exponent is clamped to at least this. Decided. */
export const EXTRAPOLATION_EXPONENT_MIN = 1.02;

/** Extrapolation past the Benchmark range: the exponent is clamped to at most this. Decided. */
export const EXTRAPOLATION_EXPONENT_MAX = 1.15;

/** Downhill equivalent-flat-distance factor at its peak (about 12% faster). Decided. */
export const DOWNHILL_CAP_FACTOR = 0.88;

/** The average grade (as a fraction) at which the downhill factor peaks. Decided (about −9.5%). */
export const DOWNHILL_CAP_GRADE = -0.095;

/** Past the peak, the downhill factor eases linearly back to 1.0 by this grade. Starting value. */
export const DOWNHILL_FLAT_AGAIN_GRADE = -0.2;

/** Prediction Confidence is low when |maximum grade| exceeds this (as a fraction). Decided. */
export const LOW_CONFIDENCE_MAX_GRADE = 0.15;

/** Rolling when total_elevation_gain > this × net gain + ROLLING_THRESHOLD_EXTRA_M. Starting value. */
export const ROLLING_THRESHOLD_MULTIPLIER = 2;

/** Rolling when total_elevation_gain > ROLLING_THRESHOLD_MULTIPLIER × net gain + this (metres). Starting value. */
export const ROLLING_THRESHOLD_EXTRA_M = 10;

/** Rolling penalty: metres of flat distance added per metre of excess climb. Starting value. */
export const ROLLING_PENALTY_M_PER_M = 8;

/** Check for new runs at most once per this many hours. Decided. */
export const NEW_RUN_CHECK_THROTTLE_HOURS = 3;

/** Segment details older than this many days are re-fetched and show their age. Decided. */
export const FRESHNESS_AGE_DAYS = 30;

/** Search stop rule: look at the last this-many runs fetched... Decided. */
export const STOP_RULE_RECENT_RUNS = 10;

/** ...and stop when together they added fewer than this many new Segments. Decided. */
export const STOP_RULE_MIN_NEW_SEGMENTS = 3;

/** Search stop rule: stop at this share of ground coverage. Decided. */
export const SEARCH_STOP_COVERAGE = 0.95;

/** Ground coverage is measured in grid cells about this many metres across. Starting value. */
export const COVERAGE_CELL_M = 100;

/** Strava reads a Runner may use per UTC day. Decided. */
export const RUNNER_DAILY_READS = 500;

/** Reads kept back in each 15-minute window for interactive calls. Decided. */
export const INTERACTIVE_READ_RESERVE = 10;

/** Cloud Scheduler (and the dev interval) ticks this often, in minutes. Decided. */
export const TICK_INTERVAL_MINUTES = 5;

/** The Results page polls this often while work is pending, in seconds. Decided. */
export const RESULTS_POLL_SECONDS = 5;

/** A tick drains for at most this many seconds. Decided. */
export const TICK_DRAIN_SECONDS = 20;

/** A results poll drains for up to about this many seconds while work is pending. Decided. */
export const RESULTS_DRAIN_SECONDS = 2;

/** First burst of a search: about this many runs... Decided. */
export const FIRST_BURST_RUNS = 20;

/** ...and this many Segment details... Decided. */
export const FIRST_BURST_SEGMENT_DETAILS = 60;

/** ...with this many Strava calls in parallel. Decided. */
export const FIRST_BURST_PARALLEL = 8;
