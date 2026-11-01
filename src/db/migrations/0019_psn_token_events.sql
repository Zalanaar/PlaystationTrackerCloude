CREATE TABLE "psn_token_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "psn_token_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"event" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psn_token_events_event_check" CHECK ("psn_token_events"."event" in ('pasted','refreshed','expired','from_env'))
);
--> statement-breakpoint
ALTER TABLE "login_attempts" DROP CONSTRAINT "login_attempts_kind_check";--> statement-breakpoint
ALTER TABLE "psn_token_events" ADD CONSTRAINT "psn_token_events_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "psn_token_events_created_idx" ON "psn_token_events" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_kind_check" CHECK ("login_attempts"."kind" in ('password','google','npsso'));