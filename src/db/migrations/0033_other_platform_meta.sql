CREATE TABLE "other_platform_meta" (
	"manual_game_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" text,
	"status_changed_at" timestamp with time zone,
	"rating" smallint,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "other_platform_meta_status_check" CHECK ("other_platform_meta"."status" is null or "other_platform_meta"."status" in ('playing','completed','backlog','dropped')),
	CONSTRAINT "other_platform_meta_rating_check" CHECK ("other_platform_meta"."rating" is null or "other_platform_meta"."rating" between 0 and 10),
	CONSTRAINT "other_platform_meta_note_check" CHECK ("other_platform_meta"."note" is null or char_length("other_platform_meta"."note") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "other_platform_meta" ADD CONSTRAINT "other_platform_meta_manual_game_id_manual_games_id_fk" FOREIGN KEY ("manual_game_id") REFERENCES "public"."manual_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "other_platform_meta" ADD CONSTRAINT "other_platform_meta_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "other_platform_meta_user_idx" ON "other_platform_meta" USING btree ("user_id");