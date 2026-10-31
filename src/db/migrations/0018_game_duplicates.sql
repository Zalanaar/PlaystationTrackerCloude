ALTER TABLE "games" ADD COLUMN "duplicate_of_game_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "not_duplicate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_duplicate_of_fk" FOREIGN KEY ("user_id","duplicate_of_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_user_duplicate_of_idx" ON "games" USING btree ("user_id","duplicate_of_game_id") WHERE "games"."duplicate_of_game_id" is not null;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_duplicate_self_check" CHECK ("games"."duplicate_of_game_id" is null or "games"."duplicate_of_game_id" <> "games"."id");