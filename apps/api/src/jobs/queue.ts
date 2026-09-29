// The Strava job queue: work sits in `strava_jobs` and is drained by requests and the tick.
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { STRAVA_JOB_KINDS, stravaJobs } from '../db/schema.js';
import { StravaRevokedError, type StravaClient } from '../strava/client.js';

export type JobKind = (typeof STRAVA_JOB_KINDS)[number];
export type Job = typeof stravaJobs.$inferSelect;

/** Job priorities, highest first: search > new-run details > mapping > freshness. */
export const JOB_PRIORITY = {
  search: 400,
  'new-run': 300,
  mapping: 200,
  freshness: 100,
} as const;
export type JobPriority = keyof typeof JOB_PRIORITY;

// TODO(decision): the spec doesn't set the retry policy. A failing job is tried this many
// times in all, waiting RETRY_BACKOFF_MS × 2^(attempt - 1) between tries.
/** A job that has failed this many times is marked failed. */
export const MAX_JOB_ATTEMPTS = 5;
/** The wait before the first retry; it doubles with each further attempt. */
export const RETRY_BACKOFF_MS = 60 * 1000;
/**
 * A claimed job's lease: if the drain running it dies (a deploy, a crash), another drain may
 * claim it again once this has passed. Handlers take seconds, so this is generous.
 */
export const JOB_LEASE_MS = 5 * 60 * 1000;

export type JobContext = {
  db: Database['db'];
  strava: StravaClient;
  /** The drain's clock. */
  now: () => Date;
};

/** Runs one job. Throwing records a retry (or, past the attempt limit, a failure). */
export type JobHandler = (job: Job, context: JobContext) => Promise<void>;
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;

export type NewJob = {
  kind: JobKind;
  /** The activity or Segment id (or the page), depending on the kind. */
  target?: number | null;
  runnerId: number;
  crawlId?: number | null;
  priority: JobPriority;
};

export type DrainOptions = {
  /** No job is claimed at or after this time. */
  deadline: Date;
  now: () => Date;
  strava: StravaClient;
  /** How many jobs run at once. */
  concurrency?: number;
};

export type DrainResult = { succeeded: number; retried: number; failed: number };

/**
 * The queue, with its handlers registered by kind. A job whose kind has no handler fails
 * straight away.
 */
export function createJobQueue(db: Database['db'], handlers: JobHandlers) {
  /**
   * Adds a pending job. An identical pending job (same kind, Runner and target) isn't
   * duplicated: it keeps its place, takes the higher of the two priorities, and gains the
   * crawl link if it had none. Returns the pending job's id.
   */
  async function enqueue(job: NewJob, now = new Date()): Promise<number> {
    const target = job.target ?? null;
    const crawlId = job.crawlId ?? null;
    const [row] = await db.execute<{ id: number }>(sql`
      insert into ${stravaJobs} (kind, target, runner_id, crawl_id, priority, not_before)
      values (${job.kind}, ${target}, ${job.runnerId}, ${crawlId}, ${JOB_PRIORITY[job.priority]},
        ${now.toISOString()}::timestamptz)
      on conflict (kind, runner_id, coalesce(target, -1)) where status = 'pending'
      do update set
        priority = greatest(${stravaJobs}.priority, excluded.priority),
        crawl_id = coalesce(${stravaJobs}.crawl_id, excluded.crawl_id),
        updated_at = now()
      returning id`);
    return row!.id;
  }

  /** Claims the most urgent runnable job (or one whose lease ran out), or returns undefined. */
  async function claim(now: Date): Promise<Job | undefined> {
    const next = db
      .select({ id: stravaJobs.id })
      .from(stravaJobs)
      .where(
        and(
          or(eq(stravaJobs.status, 'pending'), eq(stravaJobs.status, 'running')),
          lte(stravaJobs.notBefore, now),
        ),
      )
      .orderBy(desc(stravaJobs.priority), asc(stravaJobs.id))
      .limit(1)
      .for('update', { skipLocked: true });
    const [job] = await db
      .update(stravaJobs)
      .set({
        status: 'running',
        attempts: sql`${stravaJobs.attempts} + 1`,
        // While running, not_before is the lease's end.
        notBefore: new Date(now.getTime() + JOB_LEASE_MS),
      })
      .where(inArray(stravaJobs.id, next))
      .returning();
    return job;
  }

  async function run(job: Job, context: JobContext): Promise<keyof DrainResult | undefined> {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for ${job.kind} jobs`);
      await handler(job, context);
    } catch (error) {
      // The Runner has been deleted, and their jobs with them: there's nothing to record.
      if (error instanceof StravaRevokedError) return undefined;
      const now = context.now();
      const lastError = error instanceof Error ? error.message : String(error);
      if (handler && job.attempts < MAX_JOB_ATTEMPTS) {
        const backoff = RETRY_BACKOFF_MS * 2 ** (job.attempts - 1);
        await db
          .update(stravaJobs)
          .set({ status: 'pending', notBefore: new Date(now.getTime() + backoff), lastError })
          .where(eq(stravaJobs.id, job.id));
        return 'retried';
      }
      await db
        .update(stravaJobs)
        .set({ status: 'failed', lastError, finishedAt: now })
        .where(eq(stravaJobs.id, job.id));
      return 'failed';
    }
    await db
      .update(stravaJobs)
      .set({ status: 'done', lastError: null, finishedAt: context.now() })
      .where(eq(stravaJobs.id, job.id));
    return 'succeeded';
  }

  /**
   * Runs jobs, most urgent first, until none are runnable or the deadline passes. Claims use
   * `FOR UPDATE SKIP LOCKED`, so overlapping drains (other requests, instances or deploys)
   * never run the same job.
   */
  async function drain({ deadline, now, strava, concurrency = 1 }: DrainOptions) {
    const result: DrainResult = { succeeded: 0, retried: 0, failed: 0 };
    const context: JobContext = { db, strava, now };
    async function worker() {
      while (now() < deadline) {
        const job = await claim(now());
        if (!job) return;
        const outcome = await run(job, context);
        if (outcome) result[outcome] += 1;
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return result;
  }

  return { enqueue, drain };
}

export type JobQueue = ReturnType<typeof createJobQueue>;
