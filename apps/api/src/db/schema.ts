// Drizzle table definitions. Tables are added by the tasks that need them.
import { bigint, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// A Runner: a Strava athlete who has connected their account to myKOM.
export const runners = pgTable('runners', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  // Strava athlete ids have outgrown 32-bit integers.
  stravaAthleteId: bigint('strava_athlete_id', { mode: 'number' }).notNull().unique(),
  firstName: text('first_name').notNull(),
  // Strava's `sex` ('M' | 'F'); null when the athlete hasn't set it.
  sex: text('sex', { enum: ['M', 'F'] }),
  avatarUrl: text('avatar_url'),
  // Strava subscription status (the athlete's `summit`/`premium` flag).
  isSubscriber: boolean('is_subscriber').notNull().default(false),
  ...timestamps,
});

// The Runner's Strava OAuth tokens: one row per Runner.
export const stravaTokens = pgTable('strava_tokens', {
  runnerId: integer('runner_id')
    .primaryKey()
    .references(() => runners.id, { onDelete: 'cascade' }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // The scopes the Runner actually granted (they can untick some on Strava's consent screen).
  grantedScopes: text('granted_scopes').array().notNull(),
  ...timestamps,
});

export type Runner = typeof runners.$inferSelect;
export type NewRunner = typeof runners.$inferInsert;
export type StravaToken = typeof stravaTokens.$inferSelect;
export type NewStravaToken = typeof stravaTokens.$inferInsert;
