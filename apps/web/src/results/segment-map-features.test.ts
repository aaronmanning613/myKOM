import { encodePolyline, type ResultRow, type Results } from '@mykom/shared';
import { describe, expect, it } from 'vitest';
import { circleBounds } from '../map/geometry';
import { routeMarkers } from './route-markers';
import { segmentMapFeatures } from './segment-map-features';

function row(segmentId: number, overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    segmentId,
    name: `Segment ${segmentId}`,
    distance: 1000,
    averageGrade: 0.01,
    kmFromCentre: 0.5,
    athleteCount: 100,
    record: 180,
    predicted: null,
    pb: null,
    held: false,
    implausible: false,
    recordCheckedAt: '2026-09-30T00:00:00.000Z',
    start: { lat: 45.42, lng: -75.69 },
    polyline: null,
    ...overrides,
  };
}

const searchArea: Results['searchArea'] = {
  label: 'Ottawa',
  lat: 45.42,
  lng: -75.69,
  radiusKm: 2,
};

function features(
  targets: ResultRow[],
  nearestMisses: ResultRow[] = [],
  suspicious: ResultRow[] = [],
) {
  return segmentMapFeatures({ searchArea, targets, nearestMisses, suspicious } as Results);
}

const route = [
  { lat: 45.42, lng: -75.69 },
  { lat: 45.425, lng: -75.7 },
  { lat: 45.43, lng: -75.695 },
];

describe('segmentMapFeatures', () => {
  it('draws a route when the polyline decodes to at least 2 points', () => {
    const [feature] = features([row(1, { polyline: encodePolyline(route) })]).segments;
    expect(feature!.shape).toEqual({ kind: 'route', points: route, markers: routeMarkers(route) });
  });

  it('attaches start, finish and arrow markers to routes only', () => {
    const [routed, startOnly] = features([
      row(1, { polyline: encodePolyline(route) }),
      row(2, { polyline: null }),
    ]).segments;
    expect(routed!.shape).toMatchObject({
      markers: { start: route[0], finish: route[2], loop: false },
    });
    expect(startOnly!.shape).not.toHaveProperty('markers');
  });

  it.each([
    ['no polyline', null],
    ['an empty polyline', ''],
    ['a 1-point polyline', encodePolyline([{ lat: 45.42, lng: -75.69 }])],
    ['an undecodable polyline', '~~~~~'],
    [
      'a polyline that decodes off the Earth',
      encodePolyline([
        { lat: 200, lng: 0 },
        { lat: 201, lng: 0 },
      ]),
    ],
  ])('falls back to the start point with %s', (_, polyline) => {
    const start = { lat: 45.41, lng: -75.68 };
    const [feature] = features([row(1, { polyline, start })]).segments;
    expect(feature!.shape).toEqual({ kind: 'start', point: start });
  });

  it('leaves Suspicious records off', () => {
    const { segments } = features([row(1)], [row(2)], [row(3)]);
    expect(segments.map((s) => s.segmentId)).toEqual([1, 2]);
  });

  it('draws the Search Area as a circle around its centre', () => {
    const { searchArea: circle } = features([]);
    expect(circle.centre).toEqual({ lat: 45.42, lng: -75.69 });
    expect(circle.radiusMetres).toBe(2000);
    expect(circle.bounds).toEqual(circleBounds({ lat: 45.42, lng: -75.69 }, 2000));
  });

  it('bounds a route by its box and a start point by itself', () => {
    const start = { lat: 45.41, lng: -75.68 };
    const [routed, startOnly] = features([
      row(1, { polyline: encodePolyline(route) }),
      row(2, { start }),
    ]).segments;
    expect(routed!.bounds).toEqual({ minLat: 45.42, minLng: -75.7, maxLat: 45.43, maxLng: -75.69 });
    expect(startOnly!.bounds).toEqual({
      minLat: 45.41,
      minLng: -75.68,
      maxLat: 45.41,
      maxLng: -75.68,
    });
  });

  it('orders targets first, then Nearest misses, each in list order, and carries the row', () => {
    const targets = [row(5), row(2)];
    const misses = [row(9), row(1)];
    const { segments } = features(targets, misses);
    expect(segments.map((s) => [s.segmentId, s.list])).toEqual([
      [5, 'targets'],
      [2, 'targets'],
      [9, 'nearestMisses'],
      [1, 'nearestMisses'],
    ]);
    expect(segments[0]!.row).toBe(targets[0]);
  });

  it('keeps the first of a Segment that appears in both lists', () => {
    const { segments } = features([row(1)], [row(1), row(2)]);
    expect(segments.map((s) => [s.segmentId, s.list])).toEqual([
      [1, 'targets'],
      [2, 'nearestMisses'],
    ]);
  });
});
