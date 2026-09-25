// Drizzle table definitions. Tables are added by the tasks that need them.
import { BENCHMARK_SOURCES, type BenchmarkDistanceId, type SearchRadiusKm } from '@mykom/shared';
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

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

export const benchmarkSource = pgEnum('benchmark_source', BENCHMARK_SOURCES);

// The Runner's Fitness Profile: one Benchmark per Runner per distance.
export const benchmarks = pgTable(
  'benchmarks',
  {
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    // A BENCHMARK_DISTANCES id. Plain text, so the list can change without a migration.
    distance: text('distance').$type<BenchmarkDistanceId>().notNull(),
    seconds: integer('seconds').notNull(),
    source: benchmarkSource('source').notNull(),
    updatedAt: timestamps.updatedAt,
  },
  (table) => [primaryKey({ columns: [table.runnerId, table.distance] })],
);

// The Runner's Search Area: one per Runner.
export const searchAreas = pgTable('search_areas', {
  runnerId: integer('runner_id')
    .primaryKey()
    .references(() => runners.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  // A SEARCH_RADII_KM value. Plain integer, so the set can change without a migration.
  radiusKm: integer('radius_km').$type<SearchRadiusKm>().notNull(),
  ...timestamps,
});

export type Runner = typeof runners.$inferSelect;
export type NewRunner = typeof runners.$inferInsert;
export type StravaToken = typeof stravaTokens.$inferSelect;
export type NewStravaToken = typeof stravaTokens.$inferInsert;
export type BenchmarkRow = typeof benchmarks.$inferSelect;
export type SearchAreaRow = typeof searchAreas.$inferSelect;
