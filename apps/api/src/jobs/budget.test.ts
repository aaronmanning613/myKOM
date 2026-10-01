import { readFileSync } from 'node:fs';
import { INTERACTIVE_READ_RESERVE, RUNNER_DAILY_READS } from '@mykom/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runners, stravaJobs, stravaReadUsage } from '../db/schema.js';
import { createStravaClient } from '../strava/client.js';
import { randomAthleteId, useOwnTestDatabase } from '../test/app.js';
import { budgetStatus, recordRead } from './budget.js';
import { createJobQueue, type JobHandler } from './queue.js';

const { database } = useOwnTestDatabase();

// 12:05 UTC: the 15-minute window runs 12:00-12:15.
const START = new Date('2026-09-29T12:05:00Z');
const NEXT_WINDOW = new Date('2026-09-29T12:15:00Z');
const TOMORROW = new Date('2026-09-30T00:00:00Z');
const MINUTE = 60 * 1000;

const segmentBody = readFileSync(
  new URL('../strava/fixtures/segment.json', import.meta.url),
  'utf8',
);

function fakeClock() {
  let time = START.getTime();
  return {
    now: () => new Date(time),
    set: (at: Date) => {
      time = at.getTime();
    },
  };
}

function segmentResponse(headers: Record<string, string> = {}) {
  return new Response(segmentBody, { headers: { 'content-type': 'application/json', ...headers } });
}

function readHeaders(usage: [number, number], limit: [number, number] = [100, 1000]) {
  return {
    'x-ratelimit-limit': `${limit[0] * 2},${limit[1] * 2}`,
    'x-ratelimit-usage': usage.join(','),
    'x-readratelimit-limit': limit.join(','),
    'x-readratelimit-usage': usage.join(','),
  };
}

/**
 * A queue whose Segment-detail handler reads the Segment through a Strava client with a fake
 * `fetch` (answering with the Segment fixture unless told otherwise), counted by the budget.
 */
function setup(clock = fakeClock()) {
  const { db } = database();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => segmentResponse());
  const strava = createStravaClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    tokenStore: {
      load: async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: new Date('2100-01-01T00:00:00Z'),
      }),
      save: async () => {},
    },
    fetch,
    now: clock.now,
    onRead: (read) => recordRead(db, read),
  });
  const ran: { runnerId: number; target: number }[] = [];
  const handler: JobHandler = async (job, { strava }) => {
    await strava.getSegment(job.runnerId, job.target!);
    ran.push({ runnerId: job.runnerId, target: job.target! });
  };
  const queue = createJobQueue(db, { 'segment-detail': handler });
  const drain = (concurrency = 1) =>
    queue.drain({
      deadline: new Date(clock.now().getTime() + MINUTE),
      now: clock.now,
      strava,
      concurrency,
    });
  const enqueue = async (runnerId: number, targets: number[]) => {
    for (const target of targets) {
      await queue.enqueue(
        { kind: 'segment-detail', target, runnerId, priority: 'search' },
        clock.now(),
      );
    }
  };
  return { clock, fetch, ran, drain, enqueue };
}

async function newRunner() {
  const [runner] = await database()
    .db.insert(runners)
    .values({ stravaAthleteId: randomAthleteId(), firstName: 'Budget' })
    .returning({ id: runners.id });
  return runner!.id;
}

async function seedUsage(
  window: '15min' | 'day',
  windowStart: Date,
  reads: number,
  { runnerId = null, limit = null }: { runnerId?: number | null; limit?: number | null } = {},
) {
  await database()
    .db.insert(stravaReadUsage)
    .values({ window, windowStart, reads, runnerId, limit });
}

async function appReads(window: '15min' | 'day', windowStart: Date) {
  const [row] = await database()
    .db.select()
    .from(stravaReadUsage)
    .where(
      and(
        eq(stravaReadUsage.window, window),
        eq(stravaReadUsage.windowStart, windowStart),
        isNull(stravaReadUsage.runnerId),
      ),
    );
  return row;
}

async function runnerReads(runnerId: number, day: Date) {
  const [row] = await database()
    .db.select()
    .from(stravaReadUsage)
    .where(
      and(
        eq(stravaReadUsage.window, 'day'),
        eq(stravaReadUsage.windowStart, day),
        eq(stravaReadUsage.runnerId, runnerId),
      ),
    );
  return row?.reads ?? 0;
}

const TODAY = new Date('2026-09-29T00:00:00Z');
const WINDOW = new Date('2026-09-29T12:00:00Z');

beforeEach(async () => {
  await database().db.delete(stravaJobs);
  await database().db.delete(stravaReadUsage);
});

describe('counting reads', () => {
  it('takes the app-wide usage and limits from Strava’s read headers, and counts the Runner’s reads', async () => {
    const { fetch, drain, enqueue } = setup();
    fetch.mockImplementation(async () => segmentResponse(readHeaders([37, 412], [200, 2000])));
    const runnerId = await newRunner();
    await enqueue(runnerId, [1, 2]);

    await drain();

    expect(await appReads('15min', WINDOW)).toMatchObject({ reads: 37, limit: 200 });
    expect(await appReads('day', TODAY)).toMatchObject({ reads: 412, limit: 2000 });
    expect(await runnerReads(runnerId, TODAY)).toBe(2);
  });

  it('counts one read per call when Strava sends no headers', async () => {
    const { drain, enqueue } = setup();
    const runnerId = await newRunner();
    await seedUsage('15min', WINDOW, 5);
    await enqueue(runnerId, [1, 2, 3]);

    await drain();

    expect((await appReads('15min', WINDOW))?.reads).toBe(8);
    expect((await appReads('day', TODAY))?.reads).toBe(3);
    expect(await runnerReads(runnerId, TODAY)).toBe(3);
  });

  it('never lowers a counter when a response reports older usage', async () => {
    const { fetch, drain, enqueue } = setup();
    fetch.mockImplementation(async () => segmentResponse(readHeaders([3, 40])));
    await seedUsage('15min', WINDOW, 20);
    await enqueue(await newRunner(), [1]);

    await drain();

    expect((await appReads('15min', WINDOW))?.reads).toBe(20);
    expect((await appReads('day', TODAY))?.reads).toBe(40);
  });
});

describe('the interactive reserve', () => {
  it('stops drains before the last 10 reads of a window, and carries on in the next', async () => {
    const { clock, ran, drain, enqueue } = setup();
    await seedUsage('15min', WINDOW, 100 - INTERACTIVE_READ_RESERVE - 3);
    await enqueue(await newRunner(), [1, 2, 3, 4, 5, 6]);

    // Four workers at once still stop at the reserve.
    await drain(4);
    expect(ran).toHaveLength(3);
    expect((await appReads('15min', WINDOW))?.reads).toBe(100 - INTERACTIVE_READ_RESERVE);

    clock.set(NEXT_WINDOW);
    await drain(4);
    expect(ran).toHaveLength(6);
  });

  it('uses the limit Strava last reported (e.g. after the 10-athlete upgrade)', async () => {
    const { ran, drain, enqueue } = setup();
    await seedUsage('15min', WINDOW, 150, { limit: 200 });
    await enqueue(await newRunner(), [1, 2]);

    await drain();

    expect(ran).toHaveLength(2);
  });

  it('holds the reserve back from the day’s limit too, and says the work continues tomorrow', async () => {
    const { clock, ran, drain, enqueue } = setup();
    const runnerId = await newRunner();
    await seedUsage('day', TODAY, 1000 - INTERACTIVE_READ_RESERVE);
    await enqueue(runnerId, [1]);

    await drain();
    expect(ran).toHaveLength(0);
    expect(await budgetStatus(database().db, runnerId, clock.now())).toMatchObject({
      paused: { reason: 'app-day', until: TOMORROW },
      continuesTomorrow: true,
    });

    clock.set(TOMORROW);
    await drain();
    expect(ran).toHaveLength(1);
  });

  it('leaves interactive reads free to use the reserve', async () => {
    const { clock, fetch } = setup();
    const { db } = database();
    const strava = createStravaClient({
      clientId: 'id',
      clientSecret: 'secret',
      tokenStore: {
        load: async () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: TOMORROW }),
        save: async () => {},
      },
      fetch,
      now: clock.now,
      onRead: (read) => recordRead(db, read),
    });
    const runnerId = await newRunner();
    await seedUsage('15min', WINDOW, 100 - INTERACTIVE_READ_RESERVE);

    await strava.getSegment(runnerId, 1);

    expect((await appReads('15min', WINDOW))?.reads).toBe(100 - INTERACTIVE_READ_RESERVE + 1);
  });
});

describe('the per-Runner daily cap', () => {
  it('defers a capped Runner’s jobs to the next UTC day while others’ run', async () => {
    const { clock, ran, drain, enqueue } = setup();
    const capped = await newRunner();
    const other = await newRunner();
    await seedUsage('day', TODAY, RUNNER_DAILY_READS, { runnerId: capped });
    await enqueue(capped, [1, 2]);
    await enqueue(other, [3]);

    await drain();

    expect(ran).toEqual([{ runnerId: other, target: 3 }]);
    const deferred = await database()
      .db.select()
      .from(stravaJobs)
      .where(eq(stravaJobs.runnerId, capped));
    expect(deferred.map((job) => [job.status, job.notBefore])).toEqual([
      ['pending', TOMORROW],
      ['pending', TOMORROW],
    ]);
    expect(await budgetStatus(database().db, capped, clock.now())).toEqual({
      readsToday: RUNNER_DAILY_READS,
      dailyReads: RUNNER_DAILY_READS,
      paused: { reason: 'runner', until: TOMORROW },
      continuesTomorrow: true,
    });
    expect(await budgetStatus(database().db, other, clock.now())).toMatchObject({
      readsToday: 1,
      paused: null,
      continuesTomorrow: false,
    });

    clock.set(TOMORROW);
    await drain();
    expect(ran.map((job) => job.target)).toEqual([3, 1, 2]);
    expect(await budgetStatus(database().db, capped, clock.now())).toMatchObject({
      readsToday: 2,
      continuesTomorrow: false,
    });
  });

  it('stops exactly at the cap, even with several workers', async () => {
    const { ran, drain, enqueue } = setup();
    const runnerId = await newRunner();
    await seedUsage('day', TODAY, RUNNER_DAILY_READS - 2, { runnerId });
    await enqueue(runnerId, [1, 2, 3, 4, 5]);

    await drain(4);

    expect(ran).toHaveLength(2);
    expect(await runnerReads(runnerId, TODAY)).toBe(RUNNER_DAILY_READS);
    const pending = await database()
      .db.select()
      .from(stravaJobs)
      .where(eq(stravaJobs.status, 'pending'));
    expect(pending.map((job) => job.notBefore)).toEqual([TOMORROW, TOMORROW, TOMORROW]);
  });
});

describe('a 429', () => {
  it('defers the job to the next window without using an attempt, and pauses drains until then', async () => {
    const { clock, fetch, ran, drain, enqueue } = setup();
    const runnerId = await newRunner();
    fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ message: 'Rate Limit Exceeded' }), {
          status: 429,
          headers: { 'content-type': 'application/json', ...readHeaders([60, 300]) },
        }),
    );
    await enqueue(runnerId, [1, 2]);

    const result = await drain();

    expect(result).toEqual({ succeeded: 0, retried: 0, failed: 0, rateLimited: 1 });
    expect(ran).toEqual([]);
    const [job] = await database().db.select().from(stravaJobs).where(eq(stravaJobs.target, 1));
    expect(job).toMatchObject({ status: 'pending', attempts: 0, notBefore: NEXT_WINDOW });
    // Strava refused the window, so it counts as full; the day keeps the reported usage.
    expect((await appReads('15min', WINDOW))?.reads).toBe(100);
    expect((await appReads('day', TODAY))?.reads).toBe(300);
    expect(await runnerReads(runnerId, TODAY)).toBe(0);
    expect(await budgetStatus(database().db, runnerId, clock.now())).toMatchObject({
      paused: { reason: 'app-window', until: NEXT_WINDOW },
      continuesTomorrow: false,
    });

    clock.set(NEXT_WINDOW);
    await drain(2);
    expect(ran.map((r) => r.target).sort()).toEqual([1, 2]);
  });
});
