// The Strava read budget: app-wide counters per 15-minute window and per UTC day (kept in step
// with Strava's rate-limit headers), and each Runner's reads per UTC day.
import { INTERACTIVE_READ_RESERVE, RUNNER_DAILY_READS } from '@mykom/shared';
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { READ_USAGE_WINDOWS, stravaJobs, stravaReadUsage } from '../db/schema.js';
import type { StravaRateLimits, StravaReadEvent } from '../strava/client.js';

type Db = Database['db'];
type UsageWindow = (typeof READ_USAGE_WINDOWS)[number];

/** Strava's app-wide read limits before any header has told us otherwise (the single-player tier). */
export const DEFAULT_READ_LIMITS: Record<UsageWindow, number> = { '15min': 100, day: 1000 };

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** The start of the Strava window containing `at`: windows start on the quarter hour, days at 00:00 UTC. */
export function windowStart(window: UsageWindow, at: Date): Date {
  if (window === '15min') {
    return new Date(Math.floor(at.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
  }
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The start of the window after the one containing `at`. */
export function nextWindowStart(window: UsageWindow, at: Date): Date {
  const start = windowStart(window, at);
  if (window === '15min') return new Date(start.getTime() + QUARTER_HOUR_MS);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
}

/**
 * Counts a read. The app-wide counters take Strava's reported read usage when the headers carry
 * it (other instances' reads included), and otherwise count one. A 429 fills the current window,
 * so drains wait for the next one. The Runner's daily count goes up by one for each read Strava
 * accepted.
 */
export async function recordRead(
  db: Db,
  { runnerId, rateLimits, rateLimited, at }: StravaReadEvent,
) {
  const reported = rateLimits.read;
  for (const window of READ_USAGE_WINDOWS) {
    const key = window === '15min' ? 'window' : 'day';
    const limit = reported?.limit[key] ?? null;
    const usage = reported?.usage[key] ?? null;
    const reads = sql.raw('strava_read_usage.reads');
    let update;
    if (rateLimited && window === '15min') {
      const full = sql`coalesce(${limit}::int, strava_read_usage.limit, ${DEFAULT_READ_LIMITS[window]}::int)`;
      update = sql`greatest(${reads}, ${usage ?? 0}::int, ${full})`;
    } else if (usage !== null) {
      update = sql`greatest(${reads}, ${usage}::int)`;
    } else {
      update = rateLimited ? reads : sql`${reads} + 1`;
    }
    await upsertUsage(db, { window, at, runnerId: null, limit }, update);
  }
  if (rateLimited) return;
  await upsertUsage(
    db,
    { window: 'day', at, runnerId, limit: null },
    sql`${sql.raw('strava_read_usage.reads')} + 1`,
  );
}

/** Creates the counter row if needed (at zero reads), then sets its reads to `reads`. */
async function upsertUsage(
  db: Db,
  {
    window,
    at,
    runnerId,
    limit,
  }: { window: UsageWindow; at: Date; runnerId: number | null; limit: number | null },
  reads: SQL,
) {
  await db.execute(sql`
    insert into ${stravaReadUsage} as strava_read_usage ("window", window_start, runner_id, reads, "limit")
    values (${window}, ${windowStart(window, at).toISOString()}::timestamptz, ${runnerId}, 0, ${limit}::int)
    on conflict on constraint strava_read_usage_window_unique do nothing`);
  await db.execute(sql`
    update ${stravaReadUsage} as strava_read_usage
    set reads = ${reads}, "limit" = coalesce(${limit}::int, strava_read_usage."limit"), updated_at = now()
    where "window" = ${window}
      and window_start = ${windowStart(window, at).toISOString()}::timestamptz
      and runner_id is not distinct from ${runnerId}::int`);
}

/** Fills the current window after a 429, so no drain claims work until the next one. */
export function recordRateLimited(
  db: Db,
  runnerId: number,
  rateLimits: StravaRateLimits,
  at: Date,
) {
  return recordRead(db, { runnerId, rateLimits, rateLimited: true, at });
}

type AppUsage = Record<UsageWindow, { reads: number; limit: number }>;

async function appUsage(db: Db, at: Date): Promise<AppUsage> {
  const rows = await db
    .select()
    .from(stravaReadUsage)
    .where(
      and(
        isNull(stravaReadUsage.runnerId),
        sql`(${stravaReadUsage.window}, ${stravaReadUsage.windowStart}) in ((
          '15min', ${windowStart('15min', at).toISOString()}::timestamptz
        ), ('day', ${windowStart('day', at).toISOString()}::timestamptz))`,
      ),
    );
  const usage = (window: UsageWindow) => {
    const row = rows.find((r) => r.window === window);
    return { reads: row?.reads ?? 0, limit: row?.limit ?? DEFAULT_READ_LIMITS[window] };
  };
  return { '15min': usage('15min'), day: usage('day') };
}

// TODO(decision): the spec reserves 10 reads per 15-minute window for interactive calls. The
// same 10 are also held back from the day's limit, so signing in still works late in a busy day.
/**
 * Which app-wide window stops background work now, counting `inFlight` reads this drain has
 * started but Strava hasn't reported yet, or null when a job may run.
 */
function appLimitReached(usage: AppUsage, inFlight: number): UsageWindow | null {
  for (const window of ['day', '15min'] as const) {
    const { reads, limit } = usage[window];
    if (reads + inFlight >= limit - INTERACTIVE_READ_RESERVE) return window;
  }
  return null;
}

/** Each Runner's reads today, for those who have made any. */
async function runnerReadsToday(db: Db, at: Date, runnerIds?: number[]) {
  const rows = await db
    .select({ runnerId: stravaReadUsage.runnerId, reads: stravaReadUsage.reads })
    .from(stravaReadUsage)
    .where(
      and(
        eq(stravaReadUsage.window, 'day'),
        eq(stravaReadUsage.windowStart, windowStart('day', at)),
        isNotNull(stravaReadUsage.runnerId),
        runnerIds ? inArray(stravaReadUsage.runnerId, runnerIds) : undefined,
      ),
    );
  return new Map(rows.map((row) => [row.runnerId!, row.reads]));
}

/**
 * The drain's view of the budget before it claims a job: whether the app-wide windows leave
 * room outside the interactive reserve, and which Runners can't have a job claimed now.
 * Runners at their daily cap have their pending jobs moved to the next UTC day.
 */
export async function checkBudget(
  db: Db,
  at: Date,
  inFlight: { total: number; byRunner: Map<number, number> },
): Promise<{ stopped: UsageWindow | null; blockedRunners: number[] }> {
  const stopped = appLimitReached(await appUsage(db, at), inFlight.total);
  if (stopped) return { stopped, blockedRunners: [] };
  const today = await runnerReadsToday(db, at);
  const capped = [...today].filter(([, reads]) => reads >= RUNNER_DAILY_READS).map(([id]) => id);
  if (capped.length > 0) {
    const tomorrow = nextWindowStart('day', at);
    await db
      .update(stravaJobs)
      .set({
        notBefore: sql`greatest(${stravaJobs.notBefore}, ${tomorrow.toISOString()}::timestamptz)`,
      })
      .where(
        and(
          eq(stravaJobs.status, 'pending'),
          inArray(stravaJobs.runnerId, capped),
          sql`${stravaJobs.notBefore} < ${tomorrow.toISOString()}::timestamptz`,
        ),
      );
  }
  // Also those this drain would take to the cap with the reads it already has running.
  const blockedRunners = [...inFlight.byRunner]
    .filter(([id, running]) => (today.get(id) ?? 0) + running >= RUNNER_DAILY_READS)
    .map(([id]) => id);
  return { stopped: null, blockedRunners: [...new Set([...capped, ...blockedRunners])] };
}

export type BudgetStatus = {
  /** The Runner's Strava reads so far today (UTC). */
  readsToday: number;
  dailyReads: number;
  /**
   * Why background work for the Runner is waiting on the budget, and until when; null when it
   * isn't. `runner` is the Runner's daily cap; `app-day` and `app-window` are the app-wide limits.
   */
  paused: { reason: 'runner' | 'app-day' | 'app-window'; until: Date } | null;
  /** The work continues tomorrow (UTC): the "continues tomorrow" message. */
  continuesTomorrow: boolean;
};

/** Where the budget leaves the Runner's background work, for the results page. */
export async function budgetStatus(db: Db, runnerId: number, at: Date): Promise<BudgetStatus> {
  const readsToday = (await runnerReadsToday(db, at, [runnerId])).get(runnerId) ?? 0;
  let paused: BudgetStatus['paused'] = null;
  if (readsToday >= RUNNER_DAILY_READS) {
    paused = { reason: 'runner', until: nextWindowStart('day', at) };
  } else {
    const stopped = appLimitReached(await appUsage(db, at), 0);
    if (stopped === 'day') paused = { reason: 'app-day', until: nextWindowStart('day', at) };
    if (stopped === '15min') {
      paused = { reason: 'app-window', until: nextWindowStart('15min', at) };
    }
  }
  return {
    readsToday,
    dailyReads: RUNNER_DAILY_READS,
    paused,
    continuesTomorrow: paused !== null && paused.reason !== 'app-window',
  };
}
