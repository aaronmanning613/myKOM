import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { stravaTokens } from '../db/schema.js';
import type { StravaTokenSet, StravaTokenStore } from './client.js';
import { isEncrypted, type TokenCipher } from './token-cipher.js';

/** Keeps Runners' Strava tokens in the `strava_tokens` table, encrypted with `cipher`. */
export function createDbTokenStore(db: Database['db'], cipher: TokenCipher): StravaTokenStore {
  return {
    async load(runnerId) {
      const [row] = await db
        .select()
        .from(stravaTokens)
        .where(eq(stravaTokens.runnerId, runnerId))
        .limit(1);
      return (
        row && {
          accessToken: cipher.decrypt(row.accessToken),
          refreshToken: cipher.decrypt(row.refreshToken),
          expiresAt: row.expiresAt,
        }
      );
    },
    async save(runnerId, tokens) {
      // Only updates: the row (with its granted scopes) is created at sign-in.
      await db
        .update(stravaTokens)
        .set(encryptTokens(cipher, tokens))
        .where(eq(stravaTokens.runnerId, runnerId));
    },
  };
}

/** The token set as stored in `strava_tokens`: both tokens encrypted. */
export function encryptTokens(cipher: TokenCipher, tokens: StravaTokenSet): StravaTokenSet {
  return {
    accessToken: cipher.encrypt(tokens.accessToken),
    refreshToken: cipher.encrypt(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
  };
}

/**
 * Encrypts any `strava_tokens` values still stored as plain text (rows from before encryption).
 * Runs with the migrations; already-encrypted values are left alone, so it's safe to repeat.
 * Returns how many rows it encrypted.
 */
export async function encryptPlainTextTokens(
  db: Database['db'],
  cipher: TokenCipher,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        runnerId: stravaTokens.runnerId,
        accessToken: stravaTokens.accessToken,
        refreshToken: stravaTokens.refreshToken,
      })
      .from(stravaTokens)
      .for('update');
    let encrypted = 0;
    for (const { runnerId, accessToken, refreshToken } of rows) {
      if (isEncrypted(accessToken) && isEncrypted(refreshToken)) continue;
      await tx
        .update(stravaTokens)
        .set({
          accessToken: isEncrypted(accessToken) ? accessToken : cipher.encrypt(accessToken),
          refreshToken: isEncrypted(refreshToken) ? refreshToken : cipher.encrypt(refreshToken),
        })
        .where(eq(stravaTokens.runnerId, runnerId));
      encrypted++;
    }
    return encrypted;
  });
}
