-- Цели месяца на главной (аддитивно, новая таблица; по умолчанию целей нет).
CREATE TABLE "month_goals" (
	"user_id" integer NOT NULL,
	"month" text NOT NULL,
	"games" smallint,
	"hours" smallint,
	"trophies" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_goals_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "month_goals_month_check" CHECK ("month_goals"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "month_goals_games_check" CHECK ("month_goals"."games" is null or ("month_goals"."games" >= 1 and "month_goals"."games" <= 100)),
	CONSTRAINT "month_goals_hours_check" CHECK ("month_goals"."hours" is null or ("month_goals"."hours" >= 1 and "month_goals"."hours" <= 744)),
	CONSTRAINT "month_goals_trophies_check" CHECK ("month_goals"."trophies" is null or ("month_goals"."trophies" >= 1 and "month_goals"."trophies" <= 5000))
);
--> statement-breakpoint
ALTER TABLE "month_goals" ADD CONSTRAINT "month_goals_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;