ALTER TABLE "allowed_users" ADD COLUMN "tour_version" integer;--> statement-breakpoint
ALTER TABLE "allowed_users" ADD COLUMN "tour_completed_at" timestamp with time zone;