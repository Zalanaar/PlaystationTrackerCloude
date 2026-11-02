CREATE TABLE "manual_games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"rawg_id" text NOT NULL,
	"title" text NOT NULL,
	"cover_url" text,
	"release_date" date,
	"kind" text NOT NULL,
	"not_purchased" boolean DEFAULT false NOT NULL,
	"linked_game_id" integer,
	"suggested_game_id" integer,
	"rejected_game_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"platform_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_games_title_check" CHECK (char_length("manual_games"."title") between 1 and 200),
	CONSTRAINT "manual_games_kind_check" CHECK ("manual_games"."kind" in ('ps_backlog','other_platform')),
	CONSTRAINT "manual_games_not_purchased_check" CHECK ("manual_games"."kind" = 'ps_backlog' or "manual_games"."not_purchased" = false),
	CONSTRAINT "manual_games_linked_check" CHECK ("manual_games"."linked_game_id" is null or ("manual_games"."not_purchased" = false and "manual_games"."suggested_game_id" is null)),
	CONSTRAINT "manual_games_platform_label_check" CHECK ("manual_games"."platform_label" is null or char_length("manual_games"."platform_label") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "manual_games" ADD CONSTRAINT "manual_games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_games" ADD CONSTRAINT "manual_games_user_linked_fk" FOREIGN KEY ("user_id","linked_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_games" ADD CONSTRAINT "manual_games_user_suggested_fk" FOREIGN KEY ("user_id","suggested_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_games_user_rawg_kind_key" ON "manual_games" USING btree ("user_id","rawg_id","kind");--> statement-breakpoint
CREATE INDEX "manual_games_user_kind_idx" ON "manual_games" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "manual_games_user_suggested_idx" ON "manual_games" USING btree ("user_id","suggested_game_id") WHERE "manual_games"."suggested_game_id" is not null;