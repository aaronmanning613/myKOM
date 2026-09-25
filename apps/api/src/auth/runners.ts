import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { runners, stravaTokens, type Runner } from '../db/schema.js';
import type { StravaCodeExchange } from '../strava/client.js';

/**
 * Creates or updates the Runner for a Strava athlete, and saves their tokens and the scopes
 * they actually granted. Returns the Runner's id.
 */
export async function upsertRunnerFromStrava(
  db: Database['db'],
  { athlete, accessToken, refreshToken, expiresAt }: StravaCodeExchange,
  grantedScopes: string[],
): Promise<number> {
  return db.transaction(async (tx) => {
    const profile = {
      firstName: athlete.firstName,
      sex: athlete.sex,
      avatarUrl: athlete.avatarUrl,
      isSubscriber: athlete.isSubscriber,
    };
    const [runner] = await tx
      .insert(runners)
      .values({ stravaAthleteId: athlete.id, ...profile })
      .onConflictDoUpdate({
        target: runners.stravaAthleteId,
        set: { ...profile, updatedAt: new Date() },
      })
      .returning({ id: runners.id });
    const tokens = { accessToken, refreshToken, expiresAt, grantedScopes };
    await tx
      .insert(stravaTokens)
      .values({ runnerId: runner!.id, ...tokens })
      .onConflictDoUpdate({
        target: stravaTokens.runnerId,
        set: { ...tokens, updatedAt: new Date() },
      });
    return runner!.id;
  });
}

export async function findRunner(db: Database['db'], id: number): Promise<Runner | undefined> {
  const [runner] = await db.select().from(runners).where(eq(runners.id, id)).limit(1);
  return runner;
}

/** Deletes the Runner and, through cascading foreign keys, everything myKOM holds about them. */
export async function deleteRunner(db: Database['db'], id: number): Promise<void> {
  await db.delete(runners).where(eq(runners.id, id));
}
