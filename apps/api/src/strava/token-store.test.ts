import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrations.js';
import { runners, stravaTokens } from '../db/schema.js';
import { randomAthleteId, testTokenCipher, useTestDatabase } from '../test/app.js';
import { STRAVA_TOKEN_URL, createStravaClient } from './client.js';
import { TokenDecryptionError, createTokenCipher, isEncrypted } from './token-cipher.js';
import { createDbTokenStore, encryptTokens } from './token-store.js';

const database = useTestDatabase();
const { db } = database;
const runnerIds: number[] = [];

afterAll(async () => {
  if (runnerIds.length) await db.delete(runners).where(inArray(runners.id, runnerIds));
});

const HOUR_MS = 60 * 60 * 1000;

/** A Runner whose `strava_tokens` row holds exactly `accessToken` and `refreshToken`, as given. */
async function runnerWithStoredTokens(accessToken: string, refreshToken: string, expiresAt: Date) {
  const [runner] = await db
    .insert(runners)
    .values({ stravaAthleteId: randomAthleteId(), firstName: 'Tokens' })
    .returning({ id: runners.id });
  runnerIds.push(runner!.id);
  await db.insert(stravaTokens).values({
    runnerId: runner!.id,
    accessToken,
    refreshToken,
    expiresAt,
    grantedScopes: ['read'],
  });
  return runner!.id;
}

async function storedRow(runnerId: number) {
  const [row] = await db.select().from(stravaTokens).where(eq(stravaTokens.runnerId, runnerId));
  return row!;
}

describe('the database token store', () => {
  it('refreshes with the decrypted refresh token and stores the rotated tokens encrypted', async () => {
    const expired = encryptTokens(testTokenCipher, {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: new Date(Date.now() - HOUR_MS),
    });
    const runnerId = await runnerWithStoredTokens(
      expired.accessToken,
      expired.refreshToken,
      expired.expiresAt,
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: Math.floor((Date.now() + 6 * HOUR_MS) / 1000),
      }),
    );
    const store = createDbTokenStore(db, testTokenCipher);
    const client = createStravaClient({
      clientId: '1',
      clientSecret: 's',
      tokenStore: store,
      fetch,
    });

    expect(await client.getValidAccessToken(runnerId)).toBe('new-access');

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(STRAVA_TOKEN_URL);
    expect((init!.body as URLSearchParams).get('refresh_token')).toBe('old-refresh');
    const row = await storedRow(runnerId);
    expect(row.accessToken).not.toContain('new-access');
    expect(row.refreshToken).not.toContain('new-refresh');
    expect(await store.load(runnerId)).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('fails clearly when the key is not the one the tokens were encrypted with', async () => {
    const stored = encryptTokens(testTokenCipher, {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(),
    });
    const runnerId = await runnerWithStoredTokens(
      stored.accessToken,
      stored.refreshToken,
      stored.expiresAt,
    );
    const wrongKey = createDbTokenStore(db, createTokenCipher(randomBytes(32)));

    const error = await wrongKey.load(runnerId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TokenDecryptionError);
    expect((error as Error).message).toMatch(/TOKEN_ENCRYPTION_KEY is not the key/);
  });

  it('fails clearly on a plain-text token that was never migrated', async () => {
    const runnerId = await runnerWithStoredTokens('plain-a', 'plain-r', new Date());
    const store = createDbTokenStore(db, testTokenCipher);

    await expect(store.load(runnerId)).rejects.toThrow(/pnpm db:migrate/);
  });
});

describe('the token encryption migration', () => {
  it('encrypts existing plain-text rows, which then load as before, and is safe to repeat', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    const runnerId = await runnerWithStoredTokens('legacy-access', 'legacy-refresh', expiresAt);

    await runMigrations(db, testTokenCipher);

    const row = await storedRow(runnerId);
    expect(isEncrypted(row.accessToken) && isEncrypted(row.refreshToken)).toBe(true);
    expect(row.accessToken).not.toContain('legacy-access');
    expect(row.refreshToken).not.toContain('legacy-refresh');
    expect(row.grantedScopes).toEqual(['read']);
    expect(await createDbTokenStore(db, testTokenCipher).load(runnerId)).toEqual({
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
      expiresAt,
    });

    await runMigrations(db, testTokenCipher);
    const again = await storedRow(runnerId);
    expect([again.accessToken, again.refreshToken]).toEqual([row.accessToken, row.refreshToken]);
  });
});

describe('the token cipher', () => {
  it('uses a fresh IV each time and rejects a tampered value', () => {
    const first = testTokenCipher.encrypt('same');
    expect(testTokenCipher.encrypt('same')).not.toBe(first);

    const [prefix, iv, tag, ciphertext] = first.split(':');
    const flipped = Buffer.from(ciphertext!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    const tampered = [prefix, iv, tag, flipped.toString('base64url')].join(':');
    expect(() => testTokenCipher.decrypt(tampered)).toThrow(TokenDecryptionError);
  });

  it('only accepts a 32-byte key', () => {
    expect(() => createTokenCipher(randomBytes(16))).toThrow(/32 bytes/);
  });
});
