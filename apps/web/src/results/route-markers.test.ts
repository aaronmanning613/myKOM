import { distanceKm } from '@mykom/shared';
import { describe, expect, it } from 'vitest';
import { LOOP_THRESHOLD_METRES, routeMarkers } from './route-markers';

describe('routeMarkers', () => {
  it('puts the start and finish at the first and last points', () => {
    const points = [
      { lat: 45.42, lng: -75.69 },
      { lat: 45.425, lng: -75.7 },
      { lat: 45.43, lng: -75.695 },
    ];
    const markers = routeMarkers(points);
    expect(markers.start).toEqual(points[0]);
    expect(markers.finish).toEqual(points[2]);
    expect(markers.loop).toBe(false);
  });

  it('puts the arrow of a 2-point route at its midpoint, pointing east', () => {
    const { arrow } = routeMarkers([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ]);
    expect(arrow.point.lat).toBeCloseTo(0, 9);
    expect(arrow.point.lng).toBeCloseTo(0.005, 9);
    expect(arrow.bearingDegrees).toBeCloseTo(90, 6);
  });

  it('points a northward route north and a southward route south', () => {
    const north = routeMarkers([
      { lat: 45, lng: -75 },
      { lat: 45.01, lng: -75 },
    ]);
    expect(north.arrow.point.lat).toBeCloseTo(45.005, 9);
    expect(north.arrow.bearingDegrees).toBeCloseTo(0, 6);
    const south = routeMarkers([
      { lat: 45.01, lng: -75 },
      { lat: 45, lng: -75 },
    ]);
    expect(south.arrow.bearingDegrees).toBeCloseTo(180, 6);
  });

  it('gives westward bearings in [0, 360)', () => {
    const { arrow } = routeMarkers([
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0 },
    ]);
    expect(arrow.bearingDegrees).toBeCloseTo(270, 6);
  });

  it('finds the halfway point in the leg that holds it, with that leg’s bearing', () => {
    // An L: 1 unit north, then 3 units east, so halfway (2 units) is 1 unit into the second leg.
    const { arrow } = routeMarkers([
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
      { lat: 0.001, lng: 0.003 },
    ]);
    expect(arrow.point.lat).toBeCloseTo(0.001, 9);
    expect(arrow.point.lng).toBeCloseTo(0.001, 6);
    expect(arrow.bearingDegrees).toBeCloseTo(90, 3);
  });

  it('skips repeated points when finding the arrow’s leg', () => {
    // Halfway falls exactly at the repeated point; the zero-length leg there has no bearing.
    const { arrow } = routeMarkers([
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
      { lat: 0.001, lng: 0 },
      { lat: 0.001, lng: 0.001 },
    ]);
    expect(arrow.point.lat).toBeCloseTo(0.001, 9);
    expect(arrow.point.lng).toBeCloseTo(0, 9);
    expect(arrow.bearingDegrees).toBeCloseTo(0, 6);
  });

  it('puts the arrow of a zero-length route on its start, pointing north', () => {
    const point = { lat: 45.42, lng: -75.69 };
    const markers = routeMarkers([point, { ...point }, { ...point }]);
    expect(markers.arrow).toEqual({ point, bearingDegrees: 0 });
    expect(markers.loop).toBe(true);
  });

  it('calls a route a loop when its finish is within the threshold of its start', () => {
    const start = { lat: 45, lng: -75 };
    const via = { lat: 45.01, lng: -75 };
    const near = { lat: 45.0002, lng: -75 }; // about 22 m
    const far = { lat: 45.00025, lng: -75 }; // about 28 m
    expect(distanceKm(start, near) * 1000).toBeLessThan(LOOP_THRESHOLD_METRES);
    expect(distanceKm(start, far) * 1000).toBeGreaterThan(LOOP_THRESHOLD_METRES);
    expect(routeMarkers([start, via, near]).loop).toBe(true);
    expect(routeMarkers([start, via, far]).loop).toBe(false);
  });
});
