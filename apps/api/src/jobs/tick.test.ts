import { readFileSync } from 'node:fs';
import { FRESHNESS_AGE_DAYS, TICK_DRAIN_SECONDS } from '@mykom/shared';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appState,
  runnerSegments,
  runners,
  searchAreas,
  segments,
  stravaJobs,
  stravaReadUsage,
} from '../db/schema.js';
import { createStravaClient } from '../strava/client.js';
import { randomAthleteId, useOwnTestDatabase } from '../test/app.js';
import { createStravaJobHandlers } from './handlers.js';
import { createJobQueue, JOB_PRIORITY, type DrainResult } from './queue.js';
import { createTick, FRESHNESS_BATCH, HOUSEKEEPING_KEY } from './tick.js';

const { database } = useOwnTestDatabase();

const NOW = new Date('2026-09-29T12:05:00Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

const CENTRE = { lat: 45.42, lng: -75.69 };
/** A point `km` kilometres north of the centre. */
const north = (km: number) => ({ lat: CENTRE.lat + km / 111.2, lng: CENTRE.lng });
const FAR = { lat: 43.65, lng: -79.38 };

const EMPTY_DRAIN: DrainResult = { succeeded: 0, retried: 0, failed: 0, rateLimited: 0 };

function fakeClock(start = NOW) {
  let time = start.getTime();
  return {
    now: () => new Date(time),
    set: (at: Date) => {
      time = at.getTime();
    },
  };
}

/** A tick over a queue whose drain only records its calls. */
function tickWithFakeDrain() {
  const drain = vi.fn().mockResolvedValue(EMPTY_DRAIN);
  const tick = createTick({
    db: database().db,
    queue: { drain },
    strava: {} as never,
  });
  return { tick, drain };
}

async function addRunner(name: string) {
  const [row] = await database()
    .db.insert(runners)
    .values({ stravaAthleteId: randomAthleteId(), firstName: name })
    .returning({ id: runners.id });
  return row!.id;
}

async function addSegment(
  id: number,
  start: { lat: number; lng: number },
  fetchedAt: Date | null,
  knownBy: number[],
) {
  const { db } = database();
  await db.insert(segments).values({
    id,
    name: `Segment ${id}`,
    distance: 500,
    startLat: start.lat,
    startLng: start.lng,
    detailFetchedAt: fetchedAt,
  });
  for (const runnerId of knownBy) {
    await db.insert(runnerSegments).values({ runnerId, segmentId: id, viaRun: true });
  }
}

async function searchArea(runnerId: number, radiusKm: number, searchedAt: Date) {
  await database()
    .db.insert(searchAreas)
    .values({ runnerId, label: 'Home', ...CENTRE, radiusKm: radiusKm as 5, updatedAt: searchedAt });
}

async function freshnessJobs() {
  return database()
    .db.select({ target: stravaJobs.target, runnerId: stravaJobs.runnerId })
    .from(stravaJobs)
    .where(eq(stravaJobs.priority, JOB_PRIORITY.freshness))
    .orderBy(asc(stravaJobs.id));
}

beforeEach(async () => {
  const { db } = database();
  await db.delete(stravaJobs);
  await db.delete(stravaReadUsage);
  await db.delete(runners);
  await db.delete(segments);
  await db.delete(appState);
});

describe('tick', () => {
  it('drains for up to TICK_DRAIN_SECONDS', async () => {
    const { tick, drain } = tickWithFakeDrain();
    const clock = fakeClock();
    await tick(clock.now);
    expect(drain).toHaveBeenCalledOnce();
    expect(drain.mock.calls[0]![0].deadline).toEqual(
      new Date(NOW.getTime() + TICK_DRAIN_SECONDS * 1000),
    );
  });

  it('runs housekeeping once per UTC day', async () => {
    const { tick } = tickWithFakeDrain();
    const clock = fakeClock();
    expect((await tick(clock.now)).housekeeping).not.toBeNull();
    clock.set(new Date('2026-09-29T12:10:00Z'));
    expect((await tick(clock.now)).housekeeping).toBeNull();
    clock.set(new Date('2026-09-29T23:59:00Z'));
    expect((await tick(clock.now)).housekeeping).toBeNull();
    clock.set(new Date('2026-09-30T00:04:00Z'));
    expect((await tick(clock.now)).housekeeping).not.toBeNull();
    const [state] = await database()
      .db.select()
      .from(appState)
      .where(eq(appState.key, HOUSEKEEPING_KEY));
    expect(state!.value).toEqual({ lastRanAt: '2026-09-30T00:04:00.000Z' });
  });

  it('runs housekeeping once when ticks overlap', async () => {
    const { tick } = tickWithFakeDrain();
    const results = await Promise.all(Array.from({ length: 4 }, () => tick(() => NOW)));
    expect(results.filter((result) => result.housekeeping !== null)).toHaveLength(1);
  });
});

describe('freshness', () => {
  it('queues stale Known Segments, recently searched areas first, then oldest first', async () => {
    const recent = await addRunner('Recent');
    const earlier = await addRunner('Earlier');
    await searchArea(recent, 2, daysAgo(1));
    await searchArea(earlier, 5, daysAgo(10));
    // In both Search Areas: fetched with the Runner who searched most recently.
    await addSegment(1, north(1), daysAgo(40), [earlier, recent]);
    // In the earlier Runner's area only (outside the 2 km one).
    await addSegment(2, north(4), daysAgo(90), [recent, earlier]);
    // In the recent Runner's area, but they don't know it: it counts with the earlier one's.
    await addSegment(3, north(0.5), daysAgo(35), [earlier]);
    // In no Search Area: after those that are, oldest first.
    await addSegment(4, FAR, daysAgo(31), [recent]);
    await addSegment(5, FAR, daysAgo(200), [earlier]);
    // Not queued: fresh, summary-only, known by nobody, already waiting for its details.
    await addSegment(6, north(1), daysAgo(FRESHNESS_AGE_DAYS - 1), [recent]);
    await addSegment(7, north(1), null, [recent]);
    await addSegment(8, north(1), daysAgo(60), []);
    await addSegment(9, north(1), daysAgo(60), [recent]);
    await database().db.insert(stravaJobs).values({
      kind: 'segment-detail',
      target: 9,
      runnerId: earlier,
      priority: JOB_PRIORITY.search,
      notBefore: NOW,
    });

    const { tick } = tickWithFakeDrain();
    const { housekeeping } = await tick(() => NOW);

    expect(housekeeping!.freshnessQueued).toBe(5);
    expect(await freshnessJobs()).toEqual([
      { target: 1, runnerId: recent },
      { target: 2, runnerId: earlier },
      { target: 3, runnerId: earlier },
      { target: 5, runnerId: earlier },
      { target: 4, runnerId: recent },
    ]);
  });

  it(`queues at most ${FRESHNESS_BATCH} per day`, async () => {
    const runnerId = await addRunner('Many');
    const ids = Array.from({ length: FRESHNESS_BATCH + 5 }, (_, i) => i + 1);
    await database()
      .db.insert(segments)
      .values(
        ids.map((id) => ({
          id,
          name: `Segment ${id}`,
          distance: 500,
          startLat: FAR.lat,
          startLng: FAR.lng,
          detailFetchedAt: daysAgo(31 + id),
        })),
      );
    await database()
      .db.insert(runnerSegments)
      .values(ids.map((segmentId) => ({ runnerId, segmentId, viaRun: true })));
    const { tick } = tickWithFakeDrain();
    expect((await tick(() => NOW)).housekeeping!.freshnessQueued).toBe(FRESHNESS_BATCH);
    // The oldest go first.
    expect((await freshnessJobs())[0]!.target).toBe(FRESHNESS_BATCH + 5);
  });

  it('re-fetches the queued details in the same tick', async () => {
    const runnerId = await addRunner('Fresh');
    const SEGMENT_ID = 8793341;
    await addSegment(SEGMENT_ID, north(1), daysAgo(45), [runnerId]);
    const segmentBody = readFileSync(
      new URL('../strava/fixtures/segment.json', import.meta.url),
      'utf8',
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response(segmentBody, { headers: { 'content-type': 'application/json' } }),
      );
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
      now: () => NOW,
    });
    const { db } = database();
    const queue = createJobQueue(db, createStravaJobHandlers({ log: { warn: vi.fn() } }));
    const tick = createTick({ db, queue, strava });

    const { drain } = await tick(() => NOW);

    expect(drain.succeeded).toBe(1);
    expect(String(fetch.mock.calls[0]![0])).toContain(`/segments/${SEGMENT_ID}`);
    const [row] = await db.select().from(segments).where(eq(segments.id, SEGMENT_ID));
    expect(row!.detailFetchedAt).toEqual(NOW);
  });
});

describe('pruning', () => {
  it('deletes finished jobs after a week and read usage from before yesterday', async () => {
    const runnerId = await addRunner('Prune');
    const { db } = database();
    const job = (
      status: 'pending' | 'done' | 'failed',
      target: number,
      finishedAt: Date | null,
    ) => ({
      kind: 'segment-detail' as const,
      target,
      runnerId,
      priority: JOB_PRIORITY.search,
      status,
      notBefore: daysAgo(30),
      finishedAt,
    });
    await db
      .insert(stravaJobs)
      .values([
        job('done', 1, daysAgo(8)),
        job('failed', 2, daysAgo(8)),
        job('done', 3, daysAgo(6)),
        job('failed', 4, daysAgo(6)),
        job('pending', 5, null),
      ]);
    const usage = (window: '15min' | 'day', windowStart: Date, runner: number | null) => ({
      window,
      windowStart,
      runnerId: runner,
      reads: 1,
    });
    await db
      .insert(stravaReadUsage)
      .values([
        usage('day', new Date('2026-09-27T00:00:00Z'), null),
        usage('day', new Date('2026-09-27T00:00:00Z'), runnerId),
        usage('15min', new Date('2026-09-27T23:45:00Z'), null),
        usage('day', new Date('2026-09-28T00:00:00Z'), runnerId),
        usage('15min', new Date('2026-09-28T00:00:00Z'), null),
        usage('day', new Date('2026-09-29T00:00:00Z'), null),
      ]);

    const { tick } = tickWithFakeDrain();
    const { housekeeping } = await tick(() => NOW);

    expect(housekeeping).toMatchObject({ jobsPruned: 2, usagePruned: 3 });
    const left = await db
      .select({ target: stravaJobs.target })
      .from(stravaJobs)
      .orderBy(asc(stravaJobs.target));
    expect(left.map((row) => row.target)).toEqual([3, 4, 5]);
    const usageLeft = await db.select({ start: stravaReadUsage.windowStart }).from(stravaReadUsage);
    expect(usageLeft.every((row) => row.start >= new Date('2026-09-28T00:00:00Z'))).toBe(true);
    expect(usageLeft).toHaveLength(3);
  });
});
