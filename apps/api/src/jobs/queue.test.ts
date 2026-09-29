import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteRunner } from '../auth/runners.js';
import { crawls, runners, stravaJobs } from '../db/schema.js';
import { StravaRevokedError, createStravaClient } from '../strava/client.js';
import { createDbTokenStore } from '../strava/token-store.js';
import { randomAthleteId, testTokenCipher, useOwnTestDatabase } from '../test/app.js';
import {
  JOB_LEASE_MS,
  MAX_JOB_ATTEMPTS,
  RETRY_BACKOFF_MS,
  createJobQueue,
  type Job,
  type JobHandler,
} from './queue.js';

const { database } = useOwnTestDatabase();

const START = new Date('2026-09-29T12:00:00Z');
const SECOND = 1000;

/** A clock the test moves by hand. */
function fakeClock() {
  let time = START.getTime();
  return {
    now: () => new Date(time),
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function strava() {
  const { db } = database();
  return createStravaClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenStore: createDbTokenStore(db, testTokenCipher),
    fetch: vi.fn<typeof globalThis.fetch>(),
    onRevoked: (runnerId) => deleteRunner(db, runnerId),
  });
}

async function newRunner() {
  const [runner] = await database()
    .db.insert(runners)
    .values({ stravaAthleteId: randomAthleteId(), firstName: 'Queue' })
    .returning({ id: runners.id });
  return runner!.id;
}

async function jobRow(id: number) {
  const [row] = await database().db.select().from(stravaJobs).where(eq(stravaJobs.id, id));
  return row;
}

/** A handler that records the targets it ran, in order. */
function recorder() {
  const ran: (number | null)[] = [];
  const handler: JobHandler = async (job) => {
    ran.push(job.target);
  };
  return { ran, handler };
}

beforeEach(async () => {
  await database().db.delete(stravaJobs);
});

describe('enqueue', () => {
  it('keeps one pending job per kind, Runner and target, at the higher priority', async () => {
    const queue = createJobQueue(database().db, {});
    const runnerId = await newRunner();
    const clock = fakeClock();

    const first = await queue.enqueue(
      { kind: 'segment-detail', target: 7, runnerId, priority: 'freshness' },
      clock.now(),
    );
    const again = await queue.enqueue(
      { kind: 'segment-detail', target: 7, runnerId, priority: 'search' },
      clock.now(),
    );
    const lower = await queue.enqueue(
      { kind: 'segment-detail', target: 7, runnerId, priority: 'mapping' },
      clock.now(),
    );
    const otherTarget = await queue.enqueue(
      { kind: 'segment-detail', target: 8, runnerId, priority: 'mapping' },
      clock.now(),
    );
    const otherKind = await queue.enqueue(
      { kind: 'activity-detail', target: 7, runnerId, priority: 'mapping' },
      clock.now(),
    );
    const otherRunner = await queue.enqueue(
      { kind: 'segment-detail', target: 7, runnerId: await newRunner(), priority: 'mapping' },
      clock.now(),
    );

    expect(again).toBe(first);
    expect(lower).toBe(first);
    expect(new Set([first, otherTarget, otherKind, otherRunner]).size).toBe(4);
    const row = await jobRow(first);
    expect(row).toMatchObject({ status: 'pending', priority: 400, attempts: 0 });
  });

  it('treats jobs without a target as identical', async () => {
    const queue = createJobQueue(database().db, {});
    const runnerId = await newRunner();
    const first = await queue.enqueue({ kind: 'activity-list', runnerId, priority: 'new-run' });
    const again = await queue.enqueue({ kind: 'activity-list', runnerId, priority: 'new-run' });
    expect(again).toBe(first);
  });

  it('adds the crawl link to a pending job that had none', async () => {
    const queue = createJobQueue(database().db, {});
    const runnerId = await newRunner();
    const first = await queue.enqueue({
      kind: 'segment-detail',
      target: 1,
      runnerId,
      priority: 'freshness',
    });
    const [crawl] = await database()
      .db.insert(crawls)
      .values({ runnerId, lat: 45.5, lng: -73.6, radiusKm: 5 })
      .returning({ id: crawls.id });
    await queue.enqueue({
      kind: 'segment-detail',
      target: 1,
      runnerId,
      crawlId: crawl!.id,
      priority: 'search',
    });
    expect((await jobRow(first))?.crawlId).toBe(crawl!.id);
  });

  it('queues a new job once the earlier one has run', async () => {
    const { ran, handler } = recorder();
    const queue = createJobQueue(database().db, { 'segment-detail': handler });
    const runnerId = await newRunner();
    const clock = fakeClock();
    const job = { kind: 'segment-detail', target: 3, runnerId, priority: 'search' } as const;

    const first = await queue.enqueue(job, clock.now());
    await queue.drain({
      deadline: new Date(START.getTime() + 60 * SECOND),
      ...clock,
      strava: strava(),
    });
    const second = await queue.enqueue(job, clock.now());

    expect(second).not.toBe(first);
    expect(ran).toEqual([3]);
    expect((await jobRow(first))?.status).toBe('done');
    expect((await jobRow(second))?.status).toBe('pending');
  });
});

describe('drain', () => {
  const later = (clock: ReturnType<typeof fakeClock>) =>
    new Date(clock.now().getTime() + 60 * SECOND);

  it('runs jobs by priority (search > new-run > mapping > freshness), then oldest first', async () => {
    const { ran, handler } = recorder();
    const queue = createJobQueue(database().db, {
      'segment-detail': handler,
      'activity-detail': handler,
    });
    const runnerId = await newRunner();
    const clock = fakeClock();
    const priorities = ['freshness', 'mapping', 'search', 'new-run', 'search'] as const;
    for (const [target, priority] of priorities.entries()) {
      const kind = target % 2 ? 'activity-detail' : 'segment-detail';
      await queue.enqueue({ kind, target, runnerId, priority }, clock.now());
    }

    const result = await queue.drain({ deadline: later(clock), ...clock, strava: strava() });

    expect(ran).toEqual([2, 4, 3, 1, 0]);
    expect(result).toEqual({ succeeded: 5, retried: 0, failed: 0 });
  });

  it('marks a job done with its finish time', async () => {
    const { handler } = recorder();
    const queue = createJobQueue(database().db, { 'starred-segments': handler });
    const clock = fakeClock();
    const id = await queue.enqueue(
      { kind: 'starred-segments', target: 1, runnerId: await newRunner(), priority: 'search' },
      clock.now(),
    );
    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(await jobRow(id)).toMatchObject({
      status: 'done',
      attempts: 1,
      finishedAt: START,
      lastError: null,
    });
  });

  it('waits for a job’s not-before time', async () => {
    const { ran, handler } = recorder();
    const queue = createJobQueue(database().db, { 'segment-detail': handler });
    const runnerId = await newRunner();
    const clock = fakeClock();
    const future = new Date(START.getTime() + 10 * SECOND);
    await queue.enqueue(
      { kind: 'segment-detail', target: 1, runnerId, priority: 'freshness' },
      future,
    );
    await queue.enqueue(
      { kind: 'segment-detail', target: 2, runnerId, priority: 'search' },
      future,
    );
    await queue.enqueue(
      { kind: 'segment-detail', target: 3, runnerId, priority: 'mapping' },
      clock.now(),
    );

    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(ran).toEqual([3]);

    clock.advance(10 * SECOND);
    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(ran).toEqual([3, 2, 1]);
  });

  it('never runs the same job in two concurrent drains', async () => {
    const ran: number[] = [];
    const handler: JobHandler = async (job) => {
      ran.push(job.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    };
    const queue = createJobQueue(database().db, { 'segment-detail': handler });
    const otherQueue = createJobQueue(database().db, { 'segment-detail': handler });
    const runnerId = await newRunner();
    const clock = fakeClock();
    for (let target = 0; target < 30; target++) {
      await queue.enqueue(
        { kind: 'segment-detail', target, runnerId, priority: 'search' },
        clock.now(),
      );
    }

    const options = { deadline: later(clock), ...clock, strava: strava(), concurrency: 4 };
    const [a, b] = await Promise.all([queue.drain(options), otherQueue.drain(options)]);

    expect(ran).toHaveLength(30);
    expect(new Set(ran).size).toBe(30);
    expect(a.succeeded + b.succeeded).toBe(30);
  });

  it('stops claiming jobs at the deadline', async () => {
    const clock = fakeClock();
    const ran: number[] = [];
    const handler: JobHandler = async (job) => {
      ran.push(job.target!);
      clock.advance(SECOND);
    };
    const queue = createJobQueue(database().db, { 'segment-detail': handler });
    const runnerId = await newRunner();
    for (let target = 0; target < 5; target++) {
      await queue.enqueue(
        { kind: 'segment-detail', target, runnerId, priority: 'search' },
        clock.now(),
      );
    }

    const deadline = new Date(START.getTime() + 3 * SECOND);
    const result = await queue.drain({ deadline, ...clock, strava: strava() });

    expect(ran).toEqual([0, 1, 2]);
    expect(result.succeeded).toBe(3);
    const rows = await database()
      .db.select()
      .from(stravaJobs)
      .where(eq(stravaJobs.status, 'pending'));
    expect(rows.map((row) => row.target).sort()).toEqual([3, 4]);
  });

  it('retries a failing job with backoff, then gives up after the attempt limit', async () => {
    const handler = vi.fn<JobHandler>().mockRejectedValue(new Error('Strava said no'));
    const queue = createJobQueue(database().db, { 'activity-detail': handler });
    const clock = fakeClock();
    const id = await queue.enqueue(
      { kind: 'activity-detail', target: 9, runnerId: await newRunner(), priority: 'search' },
      clock.now(),
    );

    for (let attempt = 1; attempt < MAX_JOB_ATTEMPTS; attempt++) {
      const result = await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
      expect(result).toEqual({ succeeded: 0, retried: 1, failed: 0 });
      const backoff = RETRY_BACKOFF_MS * 2 ** (attempt - 1);
      expect(await jobRow(id)).toMatchObject({
        status: 'pending',
        attempts: attempt,
        lastError: 'Strava said no',
        notBefore: new Date(clock.now().getTime() + backoff),
      });
      // Not before the backoff has passed.
      clock.advance(backoff - 1);
      await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
      expect(handler).toHaveBeenCalledTimes(attempt);
      clock.advance(1);
    }

    const result = await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(result).toEqual({ succeeded: 0, retried: 0, failed: 1 });
    expect(await jobRow(id)).toMatchObject({
      status: 'failed',
      attempts: MAX_JOB_ATTEMPTS,
      lastError: 'Strava said no',
    });
    clock.advance(24 * 60 * 60 * SECOND);
    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(handler).toHaveBeenCalledTimes(MAX_JOB_ATTEMPTS);
  });

  it('succeeds on a retry', async () => {
    const handler = vi
      .fn<JobHandler>()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce(undefined);
    const queue = createJobQueue(database().db, { 'segment-detail': handler });
    const clock = fakeClock();
    const id = await queue.enqueue(
      { kind: 'segment-detail', target: 1, runnerId: await newRunner(), priority: 'search' },
      clock.now(),
    );
    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    clock.advance(RETRY_BACKOFF_MS);
    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(await jobRow(id)).toMatchObject({ status: 'done', attempts: 2, lastError: null });
  });

  it('fails a job whose kind has no handler', async () => {
    const queue = createJobQueue(database().db, {});
    const clock = fakeClock();
    const id = await queue.enqueue(
      { kind: 'starred-segments', target: 1, runnerId: await newRunner(), priority: 'search' },
      clock.now(),
    );
    const result = await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(result.failed).toBe(1);
    expect(await jobRow(id)).toMatchObject({
      status: 'failed',
      lastError: 'No handler for starred-segments jobs',
    });
  });

  it('carries on after a job finds the Runner has revoked access', async () => {
    const { ran, handler: record } = recorder();
    const revokedRunner = await newRunner();
    const queue = createJobQueue(database().db, {
      'activity-detail': async (job: Job, { db }) => {
        // As the Strava client does: delete the Runner, then throw.
        await deleteRunner(db, job.runnerId);
        throw new StravaRevokedError('revoked', job.runnerId, 401);
      },
      'segment-detail': record,
    });
    const clock = fakeClock();
    const revokedJob = await queue.enqueue(
      { kind: 'activity-detail', target: 1, runnerId: revokedRunner, priority: 'search' },
      clock.now(),
    );
    await queue.enqueue(
      { kind: 'segment-detail', target: 2, runnerId: await newRunner(), priority: 'mapping' },
      clock.now(),
    );

    const result = await queue.drain({ deadline: later(clock), ...clock, strava: strava() });

    expect(result).toEqual({ succeeded: 1, retried: 0, failed: 0 });
    expect(ran).toEqual([2]);
    expect(await jobRow(revokedJob)).toBeUndefined();
  });

  it('claims a running job again once its lease has run out', async () => {
    const { ran, handler } = recorder();
    const queue = createJobQueue(database().db, { 'segment-detail': handler });
    const clock = fakeClock();
    const runnerId = await newRunner();
    const [stuck] = await database()
      .db.insert(stravaJobs)
      .values({
        kind: 'segment-detail',
        target: 5,
        runnerId,
        priority: 400,
        status: 'running',
        attempts: 1,
        notBefore: new Date(START.getTime() + JOB_LEASE_MS),
      })
      .returning({ id: stravaJobs.id });

    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(ran).toEqual([]);

    clock.advance(JOB_LEASE_MS);
    await queue.drain({ deadline: later(clock), ...clock, strava: strava() });
    expect(ran).toEqual([5]);
    expect(await jobRow(stuck!.id)).toMatchObject({ status: 'done', attempts: 2 });
  });
});
