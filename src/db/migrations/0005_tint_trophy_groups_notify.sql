CREATE TABLE "notify_log" (
	"kind" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"sent_on" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "tint" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "tint_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trophies" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_tint_check" CHECK ("games"."tint" is null or "games"."tint" ~ '^#[0-9a-f]{6}$');