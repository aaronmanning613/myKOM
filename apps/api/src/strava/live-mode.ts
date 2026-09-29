// Live mode (E2E_LIVE=1): the real-account e2e session. Strava is real, except that nothing may
// revoke the live token: Disconnect would make the Runner re-consent on Strava.
import type { StravaClient } from './client.js';

export class DeauthorizeBlockedError extends Error {
  constructor() {
    super('Strava deauthorize is blocked in live test mode, so the live token stays valid');
    this.name = 'DeauthorizeBlockedError';
  }
}

/** The client with `deauthorize` throwing DeauthorizeBlockedError instead of calling Strava. */
export function blockDeauthorize(client: StravaClient): StravaClient {
  return {
    ...client,
    async deauthorize() {
      throw new DeauthorizeBlockedError();
    },
  };
}
