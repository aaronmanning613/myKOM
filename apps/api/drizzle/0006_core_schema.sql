CREATE TABLE "activities" (
	"id" bigint PRIMARY KEY NOT NULL,
	"runner_id" integer NOT NULL,
	"name" text NOT NULL,
	"sport_type" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"distance" double precision NOT NULL,
	"moving_time" integer NOT NULL,
	"summary_polyline" text,
	"min_lat" double precision,
	"min_lng" double precision,
	"max_lat" double precision,
	"max_lng" double precision,
	"detail_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "crawls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"runner_id" integer NOT NULL,
	"mapped_area_id" integer,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_km" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"runs_total" integer DEFAULT 0 NOT NULL,
	"runs_checked" integer DEFAULT 0 NOT NULL,
	"segments_found" integer DEFAULT 0 NOT NULL,
	"segments_total" integer DEFAULT 0 NOT NULL,
	"segments_checked" integer DEFAULT 0 NOT NULL,
	"coverage" double precision DEFAULT 0 NOT NULL,
	"recent_new_segments" integer[] DEFAULT '{}' NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness_profiles" (
	"runner_id" integer PRIMARY KEY NOT NULL,
	"vdot" double precision,
	"source_activity_ids" bigint[] DEFAULT '{}' NOT NULL,
	"generated_at" timestamp with time zone,
	"suggested_vdot" double precision,
	"suggested_source_activity_ids" bigint[],
	"suggested_at" timestamp with time zone,
	"dismissed_benchmarks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapped_areas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mapped_areas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"runner_id" integer NOT NULL,
	"label" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_km" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_segments" (
	"runner_id" integer NOT NULL,
	"segment_id" bigint NOT NULL,
	"via_run" boolean DEFAULT false NOT NULL,
	"via_starred" boolean DEFAULT false NOT NULL,
	"effort_count" integer DEFAULT 0 NOT NULL,
	"best_seconds" integer,
	"best_date" timestamp with time zone,
	"stats_pr_seconds" integer,
	"top_ten_hint" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_segments_runner_id_segment_id_pk" PRIMARY KEY("runner_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "segment_efforts" (
	"id" bigint PRIMARY KEY NOT NULL,
	"runner_id" integer NOT NULL,
	"activity_id" bigint NOT NULL,
	"segment_id" bigint NOT NULL,
	"elapsed_time" integer NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"kom_rank" integer,
	"record_achievement" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"activity_type" text,
	"distance" double precision NOT NULL,
	"average_grade" double precision,
	"maximum_grade" double precision,
	"elevation_high" double precision,
	"elevation_low" double precision,
	"total_elevation_gain" double precision,
	"start_lat" double precision NOT NULL,
	"start_lng" double precision NOT NULL,
	"end_lat" double precision,
	"end_lng" double precision,
	"polyline" text,
	"hazardous" boolean DEFAULT false NOT NULL,
	"kom_seconds" integer,
	"qom_seconds" integer,
	"kom_raw" text,
	"qom_raw" text,
	"kom_status" text,
	"qom_status" text,
	"athlete_count" integer,
	"detail_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "strava_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"target" bigint,
	"runner_id" integer NOT NULL,
	"crawl_id" integer,
	"priority" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strava_read_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "strava_read_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"runner_id" integer,
	"window" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"reads" integer DEFAULT 0 NOT NULL,
	"limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strava_read_usage_window_unique" UNIQUE NULLS NOT DISTINCT("window","window_start","runner_id")
);
--> statement-breakpoint
ALTER TABLE "benchmarks" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
-- Benchmark sources are now runner (pinned) | generated; the old 'strava' (imported) becomes generated.
UPDATE "benchmarks" SET "source" = 'generated' WHERE "source" = 'strava';--> statement-breakpoint
DROP TYPE "public"."benchmark_source";--> statement-breakpoint
CREATE TYPE "public"."benchmark_source" AS ENUM('runner', 'generated');--> statement-breakpoint
ALTER TABLE "benchmarks" ALTER COLUMN "source" SET DATA TYPE "public"."benchmark_source" USING "source"::"public"."benchmark_source";--> statement-breakpoint
ALTER TABLE "benchmarks" ADD COLUMN "generated_seconds" integer;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "record_gender" text;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "activities_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "resynced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_mapped_area_id_mapped_areas_id_fk" FOREIGN KEY ("mapped_area_id") REFERENCES "public"."mapped_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_profiles" ADD CONSTRAINT "fitness_profiles_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapped_areas" ADD CONSTRAINT "mapped_areas_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_segments" ADD CONSTRAINT "runner_segments_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_segments" ADD CONSTRAINT "runner_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_efforts" ADD CONSTRAINT "segment_efforts_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_efforts" ADD CONSTRAINT "segment_efforts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_efforts" ADD CONSTRAINT "segment_efforts_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_jobs" ADD CONSTRAINT "strava_jobs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_jobs" ADD CONSTRAINT "strava_jobs_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strava_read_usage" ADD CONSTRAINT "strava_read_usage_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_runner_start_date_idx" ON "activities" USING btree ("runner_id","start_date");--> statement-breakpoint
CREATE INDEX "crawls_runner_idx" ON "crawls" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "mapped_areas_runner_idx" ON "mapped_areas" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "runner_segments_segment_idx" ON "runner_segments" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "segment_efforts_runner_segment_idx" ON "segment_efforts" USING btree ("runner_id","segment_id");--> statement-breakpoint
CREATE INDEX "segment_efforts_activity_idx" ON "segment_efforts" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "segments_start_idx" ON "segments" USING btree ("start_lat","start_lng");--> statement-breakpoint
CREATE INDEX "segments_detail_fetched_at_idx" ON "segments" USING btree ("detail_fetched_at");--> statement-breakpoint
CREATE INDEX "strava_jobs_claim_idx" ON "strava_jobs" USING btree ("status","priority","not_before");--> statement-breakpoint
CREATE INDEX "strava_jobs_runner_idx" ON "strava_jobs" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "strava_jobs_crawl_idx" ON "strava_jobs" USING btree ("crawl_id");