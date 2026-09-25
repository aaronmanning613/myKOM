CREATE TABLE "runners" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "runners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"strava_athlete_id" bigint NOT NULL,
	"first_name" text NOT NULL,
	"sex" text,
	"avatar_url" text,
	"is_subscriber" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_strava_athlete_id_unique" UNIQUE("strava_athlete_id")
);
--> statement-breakpoint
CREATE TABLE "strava_tokens" (
	"runner_id" integer PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"granted_scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strava_tokens" ADD CONSTRAINT "strava_tokens_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;