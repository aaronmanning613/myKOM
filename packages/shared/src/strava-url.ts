/** A Segment's page on Strava, for the "View on Strava" links. */
export function stravaSegmentUrl(id: number): string {
  return `https://www.strava.com/segments/${id}`;
}
