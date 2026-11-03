-- п. 3: массовый прогон HLTB в своей таблице со своим слотом running (отдельно от sync_runs). Только expand: новая таблица и индексы.
CREATE TABLE "hltb_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hltb_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"error_reason" "sync_error_reason",
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"games_seen" integer DEFAULT 0 NOT NULL,
	"games_upserted" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb
);
--> statement-breakpoint
ALTER TABLE "hltb_runs" ADD CONSTRAINT "hltb_runs_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hltb_runs_user_started_at_idx" ON "hltb_runs" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "hltb_runs_one_running_idx" ON "hltb_runs" USING btree ((true)) WHERE "hltb_runs"."status" = 'running';