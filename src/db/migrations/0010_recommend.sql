CREATE TABLE "recommend_dislikes" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommend_llm_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recommend_llm_usage_calls_check" CHECK ("recommend_llm_usage"."calls" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recommend_reasons" (
	"game_id" integer NOT NULL,
	"signals_hash" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_reasons_game_id_signals_hash_pk" PRIMARY KEY("game_id","signals_hash"),
	CONSTRAINT "recommend_reasons_text_check" CHECK (char_length("recommend_reasons"."text") between 1 and 400)
);
--> statement-breakpoint
ALTER TABLE "recommend_dislikes" ADD CONSTRAINT "recommend_dislikes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;