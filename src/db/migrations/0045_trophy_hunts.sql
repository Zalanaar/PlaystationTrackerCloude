CREATE TABLE "hunt_games" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hunt_trophies" (
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"trophy_set_id" integer NOT NULL,
	"trophy_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hunt_trophies_user_id_trophy_set_id_trophy_id_pk" PRIMARY KEY("user_id","trophy_set_id","trophy_id")
);
--> statement-breakpoint
ALTER TABLE "hunt_games" ADD CONSTRAINT "hunt_games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_games" ADD CONSTRAINT "hunt_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_games" ADD CONSTRAINT "hunt_games_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_trophies" ADD CONSTRAINT "hunt_trophies_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_trophies" ADD CONSTRAINT "hunt_trophies_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_trophies" ADD CONSTRAINT "hunt_trophies_trophy_set_id_trophy_sets_id_fk" FOREIGN KEY ("trophy_set_id") REFERENCES "public"."trophy_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_trophies" ADD CONSTRAINT "hunt_trophies_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_trophies" ADD CONSTRAINT "hunt_trophies_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hunt_trophies" ADD CONSTRAINT "hunt_trophies_user_trophy_fk" FOREIGN KEY ("user_id","trophy_set_id","trophy_id") REFERENCES "public"."trophies"("user_id","trophy_set_id","trophy_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hunt_trophies_user_game_idx" ON "hunt_trophies" USING btree ("user_id","game_id");