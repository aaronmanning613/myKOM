// The results for the Runner's Search Area: their Known Segments there, ranked on read from
// what's stored. No Strava calls.
import {
  MIN_USABLE_BENCHMARKS,
  rank,
  softBenchmarks,
  type KnownSegment,
  type RankedRow,
  type RecordGender,
  type ResultRow,
  type Results,
  type SearchProgress,
} from '@mykom/shared';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { benchmarks, crawls, runners, runnerSegments, segments } from '../db/schema.js';
import { budgetStatus } from '../jobs/budget.js';
import { boxAround } from '../jobs/crawls.js';
import { loadSearchArea } from '../search-area/store.js';

type Db = Database['db'];

// TODO(decision): a Runner with no Strava sex and no KOM/QOM answer yet is ranked against KOMs
// (the wizard asks them before their first search).
/** The record the Runner is ranked against: from their Strava sex, else their own choice. */
export function recordGenderOf(runner: {
  sex: 'M' | 'F' | null;
  recordGender: RecordGender | null;
}): RecordGender {
  if (runner.sex === 'F') return 'QOM';
  if (runner.sex === 'M') return 'KOM';
  return runner.recordGender ?? 'KOM';
}

/** The Runner's Known Segments starting in (a box around) the area, with their Segment PBs. */
async function knownSegmentsNear(
  db: Db,
  runnerId: number,
  area: { lat: number; lng: number; radiusKm: number },
): Promise<KnownSegment[]> {
  const box = boxAround(area);
  const rows = await db
    .select({ segment: segments, link: runnerSegments })
    .from(runnerSegments)
    .innerJoin(segments, eq(segments.id, runnerSegments.segmentId))
    .where(
      and(
        eq(runnerSegments.runnerId, runnerId),
        gte(segments.startLat, box.minLat),
        lte(segments.startLat, box.maxLat),
        gte(segments.startLng, box.minLng),
        lte(segments.startLng, box.maxLng),
      ),
    );
  return rows.map(({ segment, link }) => {
    const pbs = [link.bestSeconds, link.statsPrSeconds].filter((s): s is number => s !== null);
    return {
      id: segment.id,
      start: { lat: segment.startLat, lng: segment.startLng },
      pb: pbs.length > 0 ? Math.min(...pbs) : null,
      details: segment.detailFetchedAt && {
        name: segment.name,
        metres: segment.distance,
        // Stored in percent, as Strava reports them; the model takes fractions.
        averageGrade: (segment.averageGrade ?? 0) / 100,
        maximumGrade: (segment.maximumGrade ?? 0) / 100,
        totalElevationGain: segment.totalElevationGain ?? 0,
        hazardous: segment.hazardous,
        xoms: { kom: segment.komRaw, qom: segment.qomRaw },
        athleteCount: segment.athleteCount ?? 0,
        fetchedAt: segment.detailFetchedAt.toISOString(),
      },
    };
  });
}

function toRow(row: RankedRow): ResultRow {
  const { segment } = row;
  return {
    segmentId: segment.id,
    name: segment.details.name,
    distance: segment.details.metres,
    averageGrade: segment.details.averageGrade,
    kmFromCentre: row.kmFromCentre,
    athleteCount: segment.details.athleteCount,
    record: row.record,
    predicted: row.prediction,
    pb: segment.pb,
    held: row.held,
    implausible: row.implausible,
    recordCheckedAt: segment.details.fetchedAt,
  };
}

/** The Runner's latest search crawl's progress, or null before their first search. */
async function searchProgress(db: Db, runnerId: number): Promise<SearchProgress | null> {
  const [crawl] = await db
    .select()
    .from(crawls)
    .where(and(eq(crawls.runnerId, runnerId), isNull(crawls.mappedAreaId)))
    .orderBy(desc(crawls.id))
    .limit(1);
  if (!crawl) return null;
  return {
    status: crawl.status === 'done' ? 'done' : 'running',
    runsChecked: crawl.runsChecked,
    runsTotal: crawl.runsTotal,
    segmentsChecked: crawl.segmentsChecked,
    segmentsTotal: crawl.segmentsTotal,
    segmentsFound: crawl.segmentsFound,
  };
}

/**
 * Ranks the Runner's Known Segments in their saved Search Area into the three lists, with
 * counts, the search's progress and the budget. Null when they have no Search Area.
 */
export async function loadResults(
  db: Db,
  runnerId: number,
  now = new Date(),
): Promise<Results | null> {
  const searchArea = await loadSearchArea(db, runnerId);
  if (!searchArea) return null;
  const [runner] = await db
    .select({ sex: runners.sex, recordGender: runners.recordGender })
    .from(runners)
    .where(eq(runners.id, runnerId));
  if (!runner) return null;
  const recordGender = recordGenderOf(runner);
  const profile = await db
    .select({
      distance: benchmarks.distance,
      seconds: benchmarks.seconds,
      source: benchmarks.source,
    })
    .from(benchmarks)
    .where(eq(benchmarks.runnerId, runnerId));
  const ranked = rank({
    benchmarks: profile,
    recordGender,
    area: searchArea,
    segments: await knownSegmentsNear(db, runnerId, searchArea),
  });
  const progress = await searchProgress(db, runnerId);
  const budget = await budgetStatus(db, runnerId, now);
  return {
    searchArea,
    recordGender,
    targets: ranked.targets.map(toRow),
    nearestMisses: ranked.nearestMisses.map(toRow),
    suspicious: ranked.suspicious.map(toRow),
    achievableCount: ranked.achievableCount,
    knownCount: ranked.knownCount,
    enoughBenchmarks: profile.length - softBenchmarks(profile).length >= MIN_USABLE_BENCHMARKS,
    progress,
    pending: progress?.status === 'running',
    budget: {
      continuesTomorrow: budget.continuesTomorrow,
      pausedUntil: budget.paused?.until.toISOString() ?? null,
    },
  };
}
