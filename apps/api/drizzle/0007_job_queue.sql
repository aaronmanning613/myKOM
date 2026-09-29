-- Keep one pending job per kind, Runner and target (the highest priority, then the oldest)
-- before the unique index can be created.
DELETE FROM "strava_jobs" AS "duplicate"
USING "strava_jobs" AS "kept"
WHERE "duplicate"."status" = 'pending'
  AND "kept"."status" = 'pending'
  AND "duplicate"."kind" = "kept"."kind"
  AND "duplicate"."runner_id" = "kept"."runner_id"
  AND coalesce("duplicate"."target", -1) = coalesce("kept"."target", -1)
  AND ("kept"."priority", -"kept"."id") > ("duplicate"."priority", -"duplicate"."id");--> statement-breakpoint
CREATE UNIQUE INDEX "strava_jobs_pending_unique" ON "strava_jobs" USING btree ("kind","runner_id",coalesce("target", -1)) WHERE "strava_jobs"."status" = 'pending';