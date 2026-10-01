import { describe, expect, it } from 'vitest';
import { predict, type PredictBenchmark } from './predict.js';
import { rank, type KnownSegment, type RankInput, type SegmentDetails } from './rank.js';
import { benchmarksFromVdot } from './vdot.js';

const benchmarks: PredictBenchmark[] = benchmarksFromVdot(50);
const area = { lat: 45.5, lng: -73.6, radiusKm: 5 } as const;
const KM_PER_DEGREE_LAT = 6371.0088 * (Math.PI / 180);

/** A flat 1 km Segment's Predicted Time at VDOT 50. */
const predicted = predict(benchmarks, flat(1000), null)!.seconds;

function flat(metres: number) {
  return { metres, averageGrade: 0, maximumGrade: 0, totalElevationGain: 0 };
}

type Options = {
  /** Target Record ÷ Predicted Time is 1 / ratio, so the record ratio is about this. */
  ratio?: number;
  kom?: string | null;
  qom?: string | null;
  hazardous?: boolean;
  athleteCount?: number;
  maximumGrade?: number;
  kmNorth?: number;
  pb?: number | null;
  pending?: boolean;
};

/** A flat 1 km Known Segment, `kmNorth` of the centre, with its record set by `ratio`. */
function seg(id: number, options: Options = {}): KnownSegment {
  const { ratio = 0.9, athleteCount = 100, kmNorth = 1, pb = null } = options;
  const record = `${Math.round(predicted / ratio)}s`;
  const details: SegmentDetails = {
    ...flat(1000),
    maximumGrade: options.maximumGrade ?? 0,
    name: `Segment ${id}`,
    hazardous: options.hazardous ?? false,
    xoms: { kom: options.kom === undefined ? record : options.kom, qom: options.qom ?? null },
    athleteCount,
    fetchedAt: '2026-09-01T00:00:00Z',
    polyline: null,
  };
  return {
    id,
    start: { lat: area.lat + kmNorth / KM_PER_DEGREE_LAT, lng: area.lng },
    details: options.pending ? null : details,
    pb,
  };
}

function run(segments: KnownSegment[], extra: Partial<RankInput> = {}) {
  return rank({ benchmarks, recordGender: 'KOM', area, segments, ...extra });
}

const ids = (rows: { segment: { id: number } }[]) => rows.map((row) => row.segment.id);

describe('rank', () => {
  describe('Search Area membership', () => {
    it("uses the start point's great-circle distance from the centre", () => {
      const result = run([seg(1, { kmNorth: 4.99 }), seg(2, { kmNorth: 5.01 })]);
      expect(ids(result.targets)).toEqual([1]);
      expect(result.targets[0]!.kmFromCentre).toBeCloseTo(4.99, 6);
      expect(result.excluded).toEqual([{ segmentId: 2, reason: 'outside-area' }]);
    });

    it('measures east-west distance on the great circle, not in degrees', () => {
      // 5 km east at 45.5° N is about 0.064° of longitude.
      const east = (km: number): KnownSegment => ({
        ...seg(Math.round(km * 100)),
        start: {
          lat: area.lat,
          lng: area.lng + km / (KM_PER_DEGREE_LAT * Math.cos((45.5 * Math.PI) / 180)),
        },
      });
      const result = run([east(4.9), east(5.1)]);
      expect(ids(result.targets)).toEqual([490]);
      expect(result.targets[0]!.kmFromCentre).toBeCloseTo(4.9, 2);
    });
  });

  describe('exclusion reasons', () => {
    it.each([
      ['hazardous', { hazardous: true }],
      ['missing', { kom: null }],
      ['unparseable', { kom: 'CR' }],
    ])('a %s record is no-record', (_, options) => {
      const result = run([seg(1, options)]);
      expect(result.excluded).toEqual([{ segmentId: 1, reason: 'no-record' }]);
      expect(result.targets).toEqual([]);
      expect(result.suspicious).toEqual([]);
    });

    it('fewer than two usable Benchmarks is no-prediction', () => {
      const result = run([seg(1)], { benchmarks: benchmarks.slice(0, 1) });
      expect(result.excluded).toEqual([{ segmentId: 1, reason: 'no-prediction' }]);
    });

    it('pending Segments are left out of every list', () => {
      const result = run([seg(1, { pending: true })]);
      expect(result.targets).toEqual([]);
      expect(result.nearestMisses).toEqual([]);
      expect(result.excluded).toEqual([{ segmentId: 1, reason: 'pending' }]);
    });

    it('checks the reasons in order: outside the area, pending, no record, no prediction', () => {
      const none = benchmarks.slice(0, 1);
      const result = run(
        [
          seg(1, { kmNorth: 6, pending: true }),
          seg(2, { kmNorth: 6, hazardous: true }),
          seg(3, { pending: true }),
          seg(4, { hazardous: true }),
          seg(5),
        ],
        { benchmarks: none },
      );
      expect(result.excluded).toEqual([
        { segmentId: 1, reason: 'outside-area' },
        { segmentId: 2, reason: 'outside-area' },
        { segmentId: 3, reason: 'pending' },
        { segmentId: 4, reason: 'no-record' },
        { segmentId: 5, reason: 'no-prediction' },
      ]);
    });

    it('not Achievable, when no Nearest misses are shown', () => {
      const achievable = [1, 2, 3, 4, 5].map((id) => seg(id));
      const result = run([...achievable, seg(6, { ratio: 1.2 })]);
      expect(result.excluded).toEqual([{ segmentId: 6, reason: 'not-achievable' }]);
    });
  });

  describe('Your targets', () => {
    it('includes Achievable Segments up to record × 1.05 and no further', () => {
      const result = run([seg(1, { ratio: 1.04 }), seg(2, { ratio: 1.07 })]);
      expect(ids(result.targets)).toEqual([1]);
      expect(result.targets[0]!.recordRatio).toBeCloseTo(1.04, 2);
      expect(ids(result.nearestMisses)).toEqual([2]);
    });

    it('includes every Held Segment, even outside the margin and with no prediction', () => {
      const slow = seg(1, { ratio: 1.5 });
      const record = Math.round(predicted / 1.5);
      const tie = { ...slow, pb: record };
      // A pinned Benchmark switches off the PB floor, so the prediction stays outside the margin.
      const pinned = benchmarks.map((b, i) => (i === 0 ? { ...b, source: 'runner' as const } : b));
      const result = run([tie], { benchmarks: pinned });
      expect(result.achievableCount).toBe(0);
      expect(ids(result.targets)).toEqual([1]);
      expect(result.targets[0]!.held).toBe(true);

      const noPrediction = run([tie], { benchmarks: [] });
      expect(ids(noPrediction.targets)).toEqual([1]);
      expect(noPrediction.targets[0]!.prediction).toBeNull();
    });

    it('a starred Segment never run has no PB, is not Held, and ranks normally', () => {
      const result = run([seg(1, { pb: null })]);
      expect(result.targets[0]).toMatchObject({ held: false, implausible: false });
    });

    it('shows a Held Implausible Record once, in the main list, with both flags', () => {
      const result = run([seg(1, { kom: '90s', pb: 89 })]);
      expect(ids(result.targets)).toEqual([1]);
      expect(result.targets[0]).toMatchObject({ held: true, implausible: true });
      expect(result.suspicious).toEqual([]);
      expect(result.nearestMisses).toEqual([]);
      expect(result.excluded).toEqual([]);
    });

    it('puts high confidence first, then Impressiveness desc, record ratio asc, id', () => {
      const result = run([
        seg(1, { athleteCount: 900, maximumGrade: 0.2 }), // low confidence (steep)
        seg(2, { athleteCount: 10, ratio: 0.9 }),
        seg(3, { athleteCount: 50, ratio: 0.95 }),
        seg(4, { athleteCount: 50, ratio: 0.8 }),
        seg(6, { athleteCount: 50, ratio: 0.95 }),
        seg(5, { athleteCount: 50, ratio: 0.95 }),
      ]);
      expect(ids(result.targets)).toEqual([4, 3, 5, 6, 2, 1]);
      expect(result.targets.at(-1)!.prediction).toMatchObject({
        confidence: 'low',
        reason: 'steep',
      });
    });
  });

  describe('Nearest misses', () => {
    const misses = [1.3, 1.1, 1.2].map((ratio, i) => seg(100 + i, { ratio }));

    it('are shown with 4 Achievable, sorted by record ratio', () => {
      const achievable = [1, 2, 3, 4].map((id) => seg(id));
      const result = run([...achievable, ...misses]);
      expect(result.achievableCount).toBe(4);
      expect(ids(result.nearestMisses)).toEqual([101, 102, 100]);
      expect(result.excluded).toEqual([]);
    });

    it('are not shown with 5 Achievable', () => {
      const achievable = [1, 2, 3, 4, 5].map((id) => seg(id));
      const result = run([...achievable, ...misses]);
      expect(result.achievableCount).toBe(5);
      expect(result.nearestMisses).toEqual([]);
    });

    it('are at most 10, the closest by record ratio, then id', () => {
      const many = Array.from({ length: 12 }, (_, i) => seg(i + 1, { ratio: 1.1 + i * 0.02 }));
      const tied = [seg(21, { ratio: 1.1 })];
      const result = run([...many, ...tied]);
      expect(ids(result.nearestMisses)).toEqual([1, 21, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(result.excluded.map((e) => e.segmentId)).toEqual([10, 11, 12]);
    });

    it('leave out Held, Implausible and no-record Segments', () => {
      const result = run([
        seg(1, { kom: '90s' }),
        seg(2, { hazardous: true }),
        seg(3, { ratio: 1.2, pb: 1 }),
        seg(4, { ratio: 1.2 }),
      ]);
      expect(ids(result.nearestMisses)).toEqual([4]);
    });
  });

  describe('Suspicious records', () => {
    it('lists every non-Held Implausible Record by Impressiveness, not in the main list', () => {
      const result = run([
        seg(1, { kom: '90s', athleteCount: 5 }),
        seg(2, { kom: '1:20', athleteCount: 50 }),
        seg(3),
      ]);
      expect(ids(result.suspicious)).toEqual([2, 1]);
      expect(result.suspicious.every((row) => row.implausible && !row.held)).toBe(true);
      expect(ids(result.targets)).toEqual([3]);
    });

    it('lists an Implausible Record even with no prediction', () => {
      const result = run([seg(1, { kom: '90s' })], { benchmarks: [] });
      expect(ids(result.suspicious)).toEqual([1]);
      expect(result.excluded).toEqual([]);
    });
  });

  describe('counts', () => {
    it('counts Achievable, and Known Segments in the area with details', () => {
      const result = run([
        seg(1),
        seg(2, { ratio: 1.2 }),
        seg(3, { hazardous: true }),
        seg(4, { pending: true }),
        seg(5, { kmNorth: 10 }),
      ]);
      expect(result.achievableCount).toBe(1);
      expect(result.knownCount).toBe(3);
    });
  });

  describe('gender', () => {
    it("QOM ranks against the qom record and the women's world records", () => {
      const record = `${Math.round(predicted / 0.9)}s`;
      const result = run([seg(1, { kom: null, qom: record })], { recordGender: 'QOM' });
      expect(ids(result.targets)).toEqual([1]);
      expect(run([seg(1, { kom: null, qom: record })]).excluded).toEqual([
        { segmentId: 1, reason: 'no-record' },
      ]);

      // A 2:25 km is plausible as a KOM but not as a QOM.
      const fast = seg(2, { kom: '2:25', qom: '2:25' });
      expect(run([fast]).suspicious).toEqual([]);
      expect(ids(run([fast], { recordGender: 'QOM' }).suspicious)).toEqual([2]);
    });
  });

  describe('the PB floor', () => {
    it('applies to unpinned Benchmarks and not when one is pinned', () => {
      const pb = predicted - 30;
      const unpinned = run([seg(1, { pb })]).targets[0]!.prediction;
      expect(unpinned).toMatchObject({ seconds: pb, reason: 'pb-floor' });
      const pinned = benchmarks.map((b, i) => (i === 0 ? { ...b, source: 'runner' as const } : b));
      expect(
        run([seg(1, { pb })], { benchmarks: pinned }).targets[0]!.prediction!.seconds,
      ).toBeCloseTo(predicted, 6);
    });
  });
});
