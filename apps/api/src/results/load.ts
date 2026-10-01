// The results for the Runner's Search Area: their Known Segments there, ranked on read from
// what's stored, and the debug view of the same ranking. No Strava calls.
import {
  distanceKm,
  MIN_USABLE_BENCHMARKS,
  rank,
  recordFor,
  softBenchmarks,
  type DebugSegment,
  type DebugSegments,
  type KnownSegment,
  type RankedRow,
  type RecordGender,
  type ResultRow,
  type Results,
  type ResultsList,
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

/**
 * The Runner's Known Segments with their Segment PBs: those starting in (a box around) the
 * area, or all of them when `area` is null.
 */
async function knownSegments(
  db: Db,
  runnerId: number,
  area: { lat: number; lng: number; radiusKm: number } | null,
): Promise<KnownSegment[]> {
  const box = area && boxAround(area);
  const rows = await db
    .select({ segment: segments, link: runnerSegments })
    .from(runnerSegments)
    .innerJoin(segments, eq(segments.id, runnerSegments.segmentId))
    .where(
      and(
        eq(runnerSegments.runnerId, runnerId),
        box
          ? and(
              gte(segments.startLat, box.minLat),
              lte(segments.startLat, box.maxLat),
              gte(segments.startLng, box.minLng),
              lte(segments.startLng, box.maxLng),
            )
          : undefined,
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
 * The one ranking pipeline behind both the results and the debug endpoint: the Runner's
 * Known Segments (in the Search Area, or all of them with `everywhere`), Benchmarks and
 * record gender, through `rank`. Null when they have no Search Area.
 */
async function loadRanking(db: Db, runnerId: number, { everywhere = false } = {}) {
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
  const known = await knownSegments(db, runnerId, everywhere ? null : searchArea);
  const ranked = rank({ benchmarks: profile, recordGender, area: searchArea, segments: known });
  return { searchArea, recordGender, profile, known, ranked };
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
  const ranking = await loadRanking(db, runnerId);
  if (!ranking) return null;
  const { searchArea, recordGender, profile, ranked } = ranking;
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

/**
 * Every one of the Runner's Known Segments (not only those near the Search Area) with the list
 * it's in or the reason it's in none, from the same pipeline as `loadResults`. Nearest first.
 */
export async function loadDebugSegments(db: Db, runnerId: number): Promise<DebugSegments | null> {
  const ranking = await loadRanking(db, runnerId, { everywhere: true });
  if (!ranking) return null;
  const { searchArea, recordGender, known, ranked } = ranking;
  const lists = new Map<number, ResultsList>();
  for (const list of ['targets', 'nearestMisses', 'suspicious'] as const) {
    for (const row of ranked[list]) lists.set(row.segment.id, list);
  }
  const reasons = new Map(ranked.excluded.map(({ segmentId, reason }) => [segmentId, reason]));
  const debugSegments = known.map((segment): DebugSegment => {
    const reason = reasons.get(segment.id) ?? null;
    const record = segment.details && recordFor(segment.details, recordGender);
    return {
      segmentId: segment.id,
      name: segment.details?.name ?? null,
      kmFromCentre: distanceKm(searchArea, segment.start),
      list: lists.get(segment.id) ?? null,
      reason,
      recordStatus:
        reason === 'no-record' && record && record.status !== 'ok' ? record.status : null,
    };
  });
  debugSegments.sort((a, b) => a.kmFromCentre - b.kmFromCentre || a.segmentId - b.segmentId);
  return { searchArea, recordGender, segments: debugSegments };
}
