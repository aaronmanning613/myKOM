import { describe, expect, it } from 'vitest';
import { stravaSegmentUrl } from './strava-url.js';

describe('stravaSegmentUrl', () => {
  it('links to the Segment’s page on Strava', () => {
    expect(stravaSegmentUrl(229781)).toBe('https://www.strava.com/segments/229781');
  });
});
