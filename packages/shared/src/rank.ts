import { isImplausible } from './implausible.js';
import { predict, type PredictBenchmark, type PredictSegment, type Prediction } from './predict.js';
import type { SearchArea } from './search-area.js';
import { isHeld, recordFor, type RecordGender, type RecordSource } from './target-record.js';
import {
  ACHIEVABLE_MARGIN,
  MAX_NEAREST_MISSES,
  NEAREST_MISSES_BELOW_ACHIEVABLE,
} from './tunables.js';

/** A Segment's stored details (the shared `segments` row once `detail_fetched_at` is set). */
export type SegmentDetails = PredictSegment &
  RecordSource & {
    name: string;
    /** Impressiveness: how many athletes have run the Segment. */
    athleteCount: number;
    /** ISO 8601 timestamp of the detail fetch, for the record's age. */
    fetchedAt: string;
  };

/** One of the Runner's Known Segments, with their Segment PB. */
export type KnownSegment = {
  id: number;
  start: { lat: number; lng: number };
  /** Null while the Segment is pending (seen only in an effort summary). */
  details: SegmentDetails | null;
  /** The Runner's Segment PB in seconds; null when they've never run it (starred only). */
  pb: number | null;
};

export type RankInput = {
  /** With source, for the PB-floor rule. */
  benchmarks: readonly PredictBenchmark[];
  recordGender: RecordGender;
  area: Pick<SearchArea, 'lat' | 'lng' | 'radiusKm'>;
  segments: readonly KnownSegment[];
};

export type RankedRow = {
  segment: KnownSegment & { details: SegmentDetails };
  /** Great-circle distance from the Search Area centre to the start point. */
  kmFromCentre: number;
  /** The Target Record, in seconds. */
  record: number;
  /** Null when there's no prediction (only possible for a Held Segment). */
  prediction: Prediction | null;
  /** Predicted Time ÷ Target Record; null with no prediction. */
  recordRatio: number | null;
  held: boolean;
  implausible: boolean;
};

/** Why a Segment in the Runner's Known Segments appears in no list, checked in this order. */
export type ExclusionReason =
  'outside-area' | 'pending' | 'no-record' | 'no-prediction' | 'not-achievable';

export type RankResult = {
  targets: RankedRow[];
  nearestMisses: RankedRow[];
  suspicious: RankedRow[];
  achievableCount: number;
  /** Known Segments in the area that have details: the M in "N of M are Achievable". */
  knownCount: number;
  excluded: { segmentId: number; reason: ExclusionReason }[];
};

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle (haversine) distance in km. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isAchievable(row: RankedRow): boolean {
  return row.prediction !== null && row.prediction.seconds <= row.record * ACHIEVABLE_MARGIN;
}

const byId = (a: RankedRow, b: RankedRow) => a.segment.id - b.segment.id;
const byImpressiveness = (a: RankedRow, b: RankedRow) =>
  b.segment.details.athleteCount - a.segment.details.athleteCount;
// No prediction sorts after any ratio.
const byRecordRatio = (a: RankedRow, b: RankedRow) =>
  (a.recordRatio ?? Infinity) - (b.recordRatio ?? Infinity);

function thenBy(...compares: ((a: RankedRow, b: RankedRow) => number)[]) {
  return (a: RankedRow, b: RankedRow) => {
    for (const compare of compares) {
      const order = compare(a, b);
      if (order !== 0) return order;
    }
    return 0;
  };
}

// TODO(decision): a Held Segment with no prediction sorts with the low-confidence group.
const byConfidence = (a: RankedRow, b: RankedRow) =>
  Number(a.prediction?.confidence !== 'high') - Number(b.prediction?.confidence !== 'high');

/**
 * Ranks the Runner's Known Segments in a Search Area into Your targets, Nearest misses and
 * Suspicious records. Pure: nothing derived is stored, so edits apply on the next call.
 */
export function rank(input: RankInput): RankResult {
  const excluded: RankResult['excluded'] = [];
  const achievable: RankedRow[] = [];
  const held: RankedRow[] = [];
  const suspicious: RankedRow[] = [];
  const misses: RankedRow[] = [];
  let knownCount = 0;

  for (const segment of input.segments) {
    const exclude = (reason: ExclusionReason) => excluded.push({ segmentId: segment.id, reason });

    const kmFromCentre = distanceKm(input.area, segment.start);
    if (kmFromCentre > input.area.radiusKm) {
      exclude('outside-area');
      continue;
    }
    const { details } = segment;
    // TODO(decision): pending Segments get their own reason (after the area check) so the
    // debug endpoint accounts for every Known Segment.
    if (!details) {
      exclude('pending');
      continue;
    }
    knownCount += 1;

    const record = recordFor(details, input.recordGender);
    if (record.status !== 'ok') {
      exclude('no-record');
      continue;
    }

    const prediction = predict(input.benchmarks, details, segment.pb);
    const row: RankedRow = {
      segment: { ...segment, details },
      kmFromCentre,
      record: record.seconds,
      prediction,
      recordRatio: prediction ? prediction.seconds / record.seconds : null,
      held: isHeld(segment.pb, record.seconds),
      implausible: isImplausible(record.seconds, details, input.recordGender),
    };

    if (row.held) held.push(row);
    else if (row.implausible) suspicious.push(row);
    else if (!prediction) exclude('no-prediction');
    else if (isAchievable(row)) achievable.push(row);
    else misses.push(row);
  }

  const achievableCount = achievable.length + held.filter(isAchievable).length;
  const showMisses = achievableCount < NEAREST_MISSES_BELOW_ACHIEVABLE;
  misses.sort(thenBy(byRecordRatio, byId));
  const nearestMisses = showMisses ? misses.slice(0, MAX_NEAREST_MISSES) : [];
  for (const row of misses.slice(nearestMisses.length)) {
    excluded.push({ segmentId: row.segment.id, reason: 'not-achievable' });
  }

  return {
    targets: [...achievable, ...held].sort(
      thenBy(byConfidence, byImpressiveness, byRecordRatio, byId),
    ),
    nearestMisses,
    suspicious: suspicious.sort(thenBy(byImpressiveness, byId)),
    achievableCount,
    knownCount,
    excluded,
  };
}
