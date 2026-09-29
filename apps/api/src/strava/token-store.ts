import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { stravaTokens } from '../db/schema.js';
import type { StravaTokenStore } from './client.js';

/** Keeps Runners' Strava tokens in the `strava_tokens` table. */
export function createDbTokenStore(db: Database['db']): StravaTokenStore {
  return {
    async load(runnerId) {
      const [row] = await db
        .select()
        .from(stravaTokens)
        .where(eq(stravaTokens.runnerId, runnerId))
        .limit(1);
      return (
        row && {
          accessToken: row.accessToken,
          refreshToken: row.refreshToken,
          expiresAt: row.expiresAt,
        }
      );
    },
    async save(runnerId, tokens) {
      // Only updates: the row (with its granted scopes) is created at sign-in.
      await db.update(stravaTokens).set(tokens).where(eq(stravaTokens.runnerId, runnerId));
    },
  };
}
