-- F1: личная оценка 0–10 и заметка к игре. Только expand: новая таблица, ограничения и индекс; старый код её не читает.
CREATE TABLE "game_reviews" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rating" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_reviews_rating_check" CHECK ("game_reviews"."rating" is null or "game_reviews"."rating" between 0 and 10),
	CONSTRAINT "game_reviews_note_check" CHECK ("game_reviews"."note" is null or char_length("game_reviews"."note") between 1 and 500),
	CONSTRAINT "game_reviews_not_empty_check" CHECK ("game_reviews"."rating" is not null or "game_reviews"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "game_reviews" ADD CONSTRAINT "game_reviews_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_reviews" ADD CONSTRAINT "game_reviews_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_reviews" ADD CONSTRAINT "game_reviews_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_reviews_user_rating_idx" ON "game_reviews" USING btree ("user_id","rating");