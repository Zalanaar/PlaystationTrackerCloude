CREATE TABLE "game_month_exclusions" (
	"game_id" integer NOT NULL,
	"month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_month_exclusions_game_id_month_pk" PRIMARY KEY("game_id","month"),
	CONSTRAINT "game_month_exclusions_month_check" CHECK ("game_month_exclusions"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "game_month_exclusions" ADD CONSTRAINT "game_month_exclusions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;