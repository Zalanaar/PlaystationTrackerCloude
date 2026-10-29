CREATE TABLE "recommend_llm_state" (
	"id" smallint PRIMARY KEY NOT NULL,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"last_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_llm_state_singleton_check" CHECK ("recommend_llm_state"."id" = 1),
	CONSTRAINT "recommend_llm_state_streak_check" CHECK ("recommend_llm_state"."fail_streak" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD COLUMN "phrase_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD COLUMN "discover_auto_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD COLUMN "discover_manual_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_phrase_calls_check" CHECK ("recommend_llm_usage"."phrase_calls" >= 0);--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_discover_auto_calls_check" CHECK ("recommend_llm_usage"."discover_auto_calls" >= 0);--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_discover_manual_calls_check" CHECK ("recommend_llm_usage"."discover_manual_calls" >= 0);