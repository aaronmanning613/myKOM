import { STRAVA_DEAUTHORIZE_URL } from './client.js';

/**
 * Stands in for Strava in test mode (end-to-end tests), so the running server never reaches it.
 * Deauthorize succeeds; anything else fails like an unavailable Strava would.
 */
export const testModeStravaFetch: typeof fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === STRAVA_DEAUTHORIZE_URL) return Response.json({});
  return Response.json({ message: 'Strava is not available in test mode' }, { status: 503 });
};
