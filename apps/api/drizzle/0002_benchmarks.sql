CREATE TYPE "public"."benchmark_source" AS ENUM('runner', 'strava');--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"runner_id" integer NOT NULL,
	"distance" text NOT NULL,
	"seconds" integer NOT NULL,
	"source" "benchmark_source" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmarks_runner_id_distance_pk" PRIMARY KEY("runner_id","distance")
);
--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;