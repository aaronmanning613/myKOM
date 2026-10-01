CREATE TABLE "crawl_runs" (
	"crawl_id" integer NOT NULL,
	"activity_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"new_cells" integer NOT NULL,
	"queued_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"new_segments" integer,
	CONSTRAINT "crawl_runs_crawl_id_activity_id_pk" PRIMARY KEY("crawl_id","activity_id")
);
--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "cells_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "cells_covered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "runs_finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crawls" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_runs_activity_idx" ON "crawl_runs" USING btree ("activity_id");