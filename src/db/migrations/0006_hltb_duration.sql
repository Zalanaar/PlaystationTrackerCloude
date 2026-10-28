ALTER TABLE "games" ADD COLUMN "hltb_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "hltb_name" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "hltb_main_hours" double precision;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "hltb_extra_hours" double precision;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "hltb_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "duration_override_hours" double precision;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_hltb_main_check" CHECK ("games"."hltb_main_hours" is null or "games"."hltb_main_hours" > 0);--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_hltb_extra_check" CHECK ("games"."hltb_extra_hours" is null or "games"."hltb_extra_hours" > 0);--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_duration_override_check" CHECK ("games"."duration_override_hours" is null or "games"."duration_override_hours" > 0);