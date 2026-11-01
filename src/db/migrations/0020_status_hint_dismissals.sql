CREATE TABLE "status_hint_dismissals" (
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_hint_dismissals_user_id_game_id_rule_pk" PRIMARY KEY("user_id","game_id","rule"),
	CONSTRAINT "status_hint_dismissals_rule_check" CHECK ("status_hint_dismissals"."rule" in ('started','stale','platinum','returned'))
);
--> statement-breakpoint
ALTER TABLE "status_hint_dismissals" ADD CONSTRAINT "status_hint_dismissals_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_hint_dismissals" ADD CONSTRAINT "status_hint_dismissals_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;