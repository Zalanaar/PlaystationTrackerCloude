CREATE TABLE "provider_usage" (
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_usage_user_id_day_provider_pk" PRIMARY KEY("user_id","day","provider"),
	CONSTRAINT "provider_usage_provider_check" CHECK ("provider_usage"."provider" in ('rawg', 'hltb')),
	CONSTRAINT "provider_usage_calls_check" CHECK ("provider_usage"."calls" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;