CREATE TABLE "planner_roll_acks" (
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planner_roll_acks_user_id_kind_period_pk" PRIMARY KEY("user_id","kind","period"),
	CONSTRAINT "planner_roll_acks_kind_check" CHECK ("planner_roll_acks"."kind" in ('year_switch')),
	CONSTRAINT "planner_roll_acks_period_check" CHECK (char_length("planner_roll_acks"."period") between 1 and 16)
);
--> statement-breakpoint
CREATE TABLE "roadmap_year_goals" (
	"user_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"mode" text NOT NULL,
	"count" smallint NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"carry_state" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "roadmap_year_goals_user_id_year_pk" PRIMARY KEY("user_id","year"),
	CONSTRAINT "roadmap_year_goals_year_check" CHECK ("roadmap_year_goals"."year" >= 2000 and "roadmap_year_goals"."year" <= 2100),
	CONSTRAINT "roadmap_year_goals_mode_check" CHECK ("roadmap_year_goals"."mode" in ('complete', 'backlog_to')),
	CONSTRAINT "roadmap_year_goals_count_check" CHECK ("roadmap_year_goals"."count" >= 0 and "roadmap_year_goals"."count" <= 1000),
	CONSTRAINT "roadmap_year_goals_carry_check" CHECK ("roadmap_year_goals"."carry_state" in ('pending', 'carried', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "month_goals" ADD COLUMN "recap_acked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "planner_roll_acks" ADD CONSTRAINT "planner_roll_acks_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_year_goals" ADD CONSTRAINT "roadmap_year_goals_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;