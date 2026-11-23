CREATE TABLE "month_goal_games" (
	"user_id" integer NOT NULL,
	"month" text NOT NULL,
	"game_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "month_goal_games_user_id_month_game_id_pk" PRIMARY KEY("user_id","month","game_id"),
	CONSTRAINT "month_goal_games_month_check" CHECK ("month_goal_games"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "month_goal_games_position_check" CHECK ("month_goal_games"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "month_goal_games" ADD CONSTRAINT "month_goal_games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_goal_games" ADD CONSTRAINT "month_goal_games_goal_fk" FOREIGN KEY ("user_id","month") REFERENCES "public"."month_goals"("user_id","month") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_goal_games" ADD CONSTRAINT "month_goal_games_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "month_goal_games_user_month_pos_idx" ON "month_goal_games" USING btree ("user_id","month","position");