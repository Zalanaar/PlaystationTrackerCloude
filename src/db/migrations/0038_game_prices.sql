-- П13.3: цена покупки игры для «стоимости часа» (аддитивно, новая таблица).
CREATE TABLE "game_prices" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"price" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_prices_price_check" CHECK ("game_prices"."price" between 0 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "game_prices" ADD CONSTRAINT "game_prices_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_prices" ADD CONSTRAINT "game_prices_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_prices" ADD CONSTRAINT "game_prices_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_prices_user_idx" ON "game_prices" USING btree ("user_id");