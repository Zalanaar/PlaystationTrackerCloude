CREATE TABLE "psn_profile" (
	"id" smallint PRIMARY KEY NOT NULL,
	"online_id" text NOT NULL,
	"avatar_url" text,
	"trophy_level" smallint,
	"trophy_progress" smallint,
	"trophy_tier" smallint,
	"earned_platinum" integer,
	"earned_gold" integer,
	"earned_silver" integer,
	"earned_bronze" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psn_profile_singleton_check" CHECK ("psn_profile"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "banner_url" text;