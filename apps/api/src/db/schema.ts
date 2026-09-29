// Drizzle table definitions. Tables are added by the tasks that need them.
import {
  BENCHMARK_SOURCES,
  RECORD_GENDERS,
  type BenchmarkDistanceId,
  type BenchmarkTime,
  type GeocodeResult,
  type RecordStatus,
  type SearchRadiusKm,
} from '@mykom/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
  // KOM or QOM, asked for in the wizard; only used when `sex` is unset.
  recordGender: text('record_gender', { enum: RECORD_GENDERS }),
  // Set when the Runner completes wizard step 2 (their first search).
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  // The last new-run check (throttled to one per 3 hours).
  activitiesCheckedAt: timestamp('activities_checked_at', { withTimezone: true }),
  // The last "Resync my runs".
  resyncedAt: timestamp('resynced_at', { withTimezone: true }),
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
    // The generated value, kept on pinned Benchmarks so the page can offer "use generated".
    generatedSeconds: integer('generated_seconds'),
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

// Nominatim results by normalised query, so repeat searches don't call Nominatim again.
export const geocodeCache = pgTable('geocode_cache', {
  query: text('query').primaryKey(),
  results: jsonb('results').$type<GeocodeResult[]>().notNull(),
  createdAt: timestamps.createdAt,
});

// A generation's source runs: Strava activity ids, best first.
const activityIds = (name: string) => bigint(name, { mode: 'number' }).array();

// The Runner's generated Fitness Profile: one row per Runner.
export const fitnessProfiles = pgTable('fitness_profiles', {
  runnerId: integer('runner_id')
    .primaryKey()
    .references(() => runners.id, { onDelete: 'cascade' }),
  // The applied generation (null until one has been applied).
  vdot: doublePrecision('vdot'),
  sourceActivityIds: activityIds('source_activity_ids')
    .notNull()
    .default(sql`'{}'`),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  // The pending suggestion, if any.
  suggestedVdot: doublePrecision('suggested_vdot'),
  suggestedSourceActivityIds: activityIds('suggested_source_activity_ids'),
  suggestedAt: timestamp('suggested_at', { withTimezone: true }),
  // The last dismissed suggestion's values, so the same suggestion isn't shown again.
  dismissedBenchmarks: jsonb('dismissed_benchmarks').$type<BenchmarkTime[]>(),
  ...timestamps,
});

// The Runner's runs from their Strava activity list. Never the raw Strava JSON.
export const activities = pgTable(
  'activities',
  {
    // The Strava activity id.
    id: bigint('id', { mode: 'number' }).primaryKey(),
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sportType: text('sport_type').notNull(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    // Metres and seconds.
    distance: doublePrecision('distance').notNull(),
    movingTime: integer('moving_time').notNull(),
    summaryPolyline: text('summary_polyline'),
    // The polyline's bounding box (null without one), for selecting the runs through an area.
    minLat: doublePrecision('min_lat'),
    minLng: doublePrecision('min_lng'),
    maxLat: doublePrecision('max_lat'),
    maxLng: doublePrecision('max_lng'),
    // When the DetailedActivity (its Segment efforts) was last fetched.
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('activities_runner_start_date_idx').on(table.runnerId, table.startDate)],
);

// Segments, shared by every Runner and kept when a Runner disconnects: they describe the
// Segment, not the Runner. A row seen only in an effort summary has `detail_fetched_at` null.
export const segments = pgTable(
  'segments',
  {
    // The Strava Segment id.
    id: bigint('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    activityType: text('activity_type'),
    // Metres.
    distance: doublePrecision('distance').notNull(),
    // Percent, as Strava reports them (the domain core takes fractions).
    averageGrade: doublePrecision('average_grade'),
    maximumGrade: doublePrecision('maximum_grade'),
    elevationHigh: doublePrecision('elevation_high'),
    elevationLow: doublePrecision('elevation_low'),
    // Only in the details.
    totalElevationGain: doublePrecision('total_elevation_gain'),
    startLat: doublePrecision('start_lat').notNull(),
    startLng: doublePrecision('start_lng').notNull(),
    endLat: doublePrecision('end_lat'),
    endLng: doublePrecision('end_lng'),
    polyline: text('polyline'),
    hazardous: boolean('hazardous').notNull().default(false),
    // The Target Records: seconds when parseable, plus the raw `xoms` display strings.
    komSeconds: integer('kom_seconds'),
    qomSeconds: integer('qom_seconds'),
    komRaw: text('kom_raw'),
    qomRaw: text('qom_raw'),
    // TODO(decision): the spec has one `record_status`, but a Segment can have a KOM and no
    // QOM, so it's kept per gender. Null until the details are fetched.
    komStatus: text('kom_status').$type<RecordStatus>(),
    qomStatus: text('qom_status').$type<RecordStatus>(),
    // Impressiveness.
    athleteCount: integer('athlete_count'),
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    // Bounding-box lookups on the start point (plus an exact distance check in the query).
    index('segments_start_idx').on(table.startLat, table.startLng),
    index('segments_detail_fetched_at_idx').on(table.detailFetchedAt),
  ],
);

// A Runner's Known Segments: the link from a Runner to a Segment they've run or starred.
export const runnerSegments = pgTable(
  'runner_segments',
  {
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    segmentId: bigint('segment_id', { mode: 'number' })
      .notNull()
      .references(() => segments.id),
    viaRun: boolean('via_run').notNull().default(false),
    viaStarred: boolean('via_starred').notNull().default(false),
    effortCount: integer('effort_count').notNull().default(0),
    // The fastest fetched effort (elapsed seconds) and when it was run.
    bestSeconds: integer('best_seconds'),
    bestDate: timestamp('best_date', { withTimezone: true }),
    // `athlete_segment_stats.pr_elapsed_time` from the Segment details, when present.
    statsPrSeconds: integer('stats_pr_seconds'),
    // An effort carried a KOM/QOM achievement or a `kom_rank` (a stale top-10 hint).
    topTenHint: boolean('top_ten_hint').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.runnerId, table.segmentId] }),
    index('runner_segments_segment_idx').on(table.segmentId),
  ],
);

// TODO(decision): the spec's Data model has no efforts table, but "Resync my runs" must
// recompute the runner_segments bests from the runs that remain, so each fetched effort is
// kept (only the fields myKOM reads) and goes with its run.
export const segmentEfforts = pgTable(
  'segment_efforts',
  {
    // The Strava effort id.
    id: bigint('id', { mode: 'number' }).primaryKey(),
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    activityId: bigint('activity_id', { mode: 'number' })
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    segmentId: bigint('segment_id', { mode: 'number' })
      .notNull()
      .references(() => segments.id),
    elapsedTime: integer('elapsed_time').notNull(),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    komRank: integer('kom_rank'),
    // The effort carried an `overall` / `overall_cr` achievement.
    recordAchievement: boolean('record_achievement').notNull().default(false),
  },
  (table) => [
    index('segment_efforts_runner_segment_idx').on(table.runnerId, table.segmentId),
    index('segment_efforts_activity_idx').on(table.activityId),
  ],
);

// Areas the Runner asked to map in the background. Status and progress live on its crawl.
export const mappedAreas = pgTable(
  'mapped_areas',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusKm: integer('radius_km').notNull(),
    ...timestamps,
  },
  (table) => [index('mapped_areas_runner_idx').on(table.runnerId)],
);

export const CRAWL_STATUSES = ['running', 'paused', 'done'] as const;

// Known Segment gathering for one search or Mapped Area: its progress and stop-rule state.
export const crawls = pgTable(
  'crawls',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    // Set for a Mapped Area's crawl; null for a search.
    mappedAreaId: integer('mapped_area_id').references(() => mappedAreas.id, {
      onDelete: 'cascade',
    }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusKm: integer('radius_km').notNull(),
    status: text('status', { enum: CRAWL_STATUSES }).notNull().default('running'),
    // "N of ~M runs checked · K Segments found".
    runsTotal: integer('runs_total').notNull().default(0),
    runsChecked: integer('runs_checked').notNull().default(0),
    segmentsFound: integer('segments_found').notNull().default(0),
    segmentsTotal: integer('segments_total').notNull().default(0),
    segmentsChecked: integer('segments_checked').notNull().default(0),
    // The share of the area's ~100 m grid cells crossed by the runs checked (0-1).
    coverage: doublePrecision('coverage').notNull().default(0),
    // New Segments added by each run checked, oldest first, for the "last 10 runs" stop rule.
    recentNewSegments: integer('recent_new_segments')
      .array()
      .notNull()
      .default(sql`'{}'`),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('crawls_runner_idx').on(table.runnerId)],
);

export const STRAVA_JOB_KINDS = [
  'activity-list',
  'activity-detail',
  'segment-detail',
  'starred-segments',
] as const;
export const STRAVA_JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;

// Queued Strava work, drained by requests and the tick.
export const stravaJobs = pgTable(
  'strava_jobs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind', { enum: STRAVA_JOB_KINDS }).notNull(),
    // The activity or Segment id (or the page), depending on the kind.
    target: bigint('target', { mode: 'number' }),
    // The Runner whose token the call uses.
    runnerId: integer('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    crawlId: integer('crawl_id').references(() => crawls.id, { onDelete: 'cascade' }),
    // Higher runs first (search > new run > mapping > freshness).
    priority: integer('priority').notNull(),
    status: text('status', { enum: STRAVA_JOB_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    notBefore: timestamp('not_before', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('strava_jobs_claim_idx').on(table.status, table.priority, table.notBefore),
    index('strava_jobs_runner_idx').on(table.runnerId),
    index('strava_jobs_crawl_idx').on(table.crawlId),
  ],
);

export const READ_USAGE_WINDOWS = ['15min', 'day'] as const;

// Strava read counters: app-wide (runner_id null) per 15-minute window and per UTC day, and
// per Runner per UTC day.
export const stravaReadUsage = pgTable(
  'strava_read_usage',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    runnerId: integer('runner_id').references(() => runners.id, { onDelete: 'cascade' }),
    window: text('window', { enum: READ_USAGE_WINDOWS }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    reads: integer('reads').notNull().default(0),
    // The limit Strava last reported for this window (app-wide rows only).
    limit: integer('limit'),
    ...timestamps,
  },
  (table) => [
    unique('strava_read_usage_window_unique')
      .on(table.window, table.windowStart, table.runnerId)
      .nullsNotDistinct(),
  ],
);

// Small app-wide key/value state, such as when housekeeping last ran.
export const appState = pgTable('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamps.updatedAt,
});

export type Runner = typeof runners.$inferSelect;
export type NewRunner = typeof runners.$inferInsert;
export type StravaToken = typeof stravaTokens.$inferSelect;
export type NewStravaToken = typeof stravaTokens.$inferInsert;
export type BenchmarkRow = typeof benchmarks.$inferSelect;
export type SearchAreaRow = typeof searchAreas.$inferSelect;
