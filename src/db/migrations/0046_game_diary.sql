CREATE TABLE "game_diary_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_diary_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_diary_entries_body_check" CHECK (char_length("game_diary_entries"."body") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "game_diary_entries" ADD CONSTRAINT "game_diary_entries_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_diary_entries" ADD CONSTRAINT "game_diary_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_diary_entries" ADD CONSTRAINT "game_diary_entries_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_diary_entries_user_game_created_idx" ON "game_diary_entries" USING btree ("user_id","game_id","created_at");