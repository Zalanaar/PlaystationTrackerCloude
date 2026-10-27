CREATE TYPE "public"."game_status_value" AS ENUM('playing', 'completed', 'dropped', 'backlog', 'shelved');--> statement-breakpoint
CREATE TYPE "public"."sync_error_reason" AS ENUM('auth_expired', 'npsso_invalid', 'access_denied', 'rate_limited', 'psn_unavailable', 'timeout', 'internal');--> statement-breakpoint
CREATE TYPE "public"."sync_run_kind" AS ENUM('daily', 'manual', 'trophy_backfill');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."trophy_set_link_source" AS ENUM('title_id', 'concept', 'name', 'manual');--> statement-breakpoint
CREATE TYPE "public"."trophy_type" AS ENUM('bronze', 'silver', 'gold', 'platinum');--> statement-breakpoint
CREATE TABLE "game_status" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"status" "game_status_value" NOT NULL,
	"completed_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_status_completed_at_check" CHECK ("game_status"."completed_at" is null or "game_status"."status" = 'completed'),
	CONSTRAINT "game_status_dropped_at_check" CHECK ("game_status"."dropped_at" is null or "game_status"."status" = 'dropped')
);
--> statement-breakpoint
CREATE TABLE "game_trophy_sets" (
	"game_id" integer NOT NULL,
	"trophy_set_id" integer NOT NULL,
	"source" "trophy_set_link_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_trophy_sets_game_id_trophy_set_id_pk" PRIMARY KEY("game_id","trophy_set_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title_id" text NOT NULL,
	"concept_id" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"image_url" text,
	"psn_genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"genres_override" text[],
	"play_duration_seconds" integer DEFAULT 0 NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"first_played_at" timestamp with time zone,
	"last_played_at" timestamp with time zone,
	"trophy_checked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_category_check" CHECK ("games"."category" in ('ps4_game','ps5_native_game','pspc_game'))
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ip_hash" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playtime_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "playtime_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"game_id" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"play_duration_seconds" integer NOT NULL,
	"play_count" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "psn_auth" (
	"id" smallint PRIMARY KEY NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"refresh_expires_at" timestamp with time zone,
	"access_token_enc" text,
	"access_expires_at" timestamp with time zone,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psn_auth_singleton_check" CHECK ("psn_auth"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "sync_run_kind" NOT NULL,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"error_reason" "sync_error_reason",
	"error_message" text,
	"snapshot_date" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"phase" text,
	"cursor" jsonb,
	"games_seen" integer DEFAULT 0 NOT NULL,
	"games_upserted" integer DEFAULT 0 NOT NULL,
	"snapshots_written" integer DEFAULT 0 NOT NULL,
	"trophy_sets_synced" integer DEFAULT 0 NOT NULL,
	"trophies_upserted" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb
);
--> statement-breakpoint
CREATE TABLE "trophies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trophies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trophy_set_id" integer NOT NULL,
	"trophy_id" integer NOT NULL,
	"type" "trophy_type" NOT NULL,
	"name" text,
	"detail" text,
	"icon_url" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"earned" boolean DEFAULT false NOT NULL,
	"earned_at" timestamp with time zone,
	"rarity" smallint,
	"earned_rate" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trophies_earned_at_check" CHECK ("trophies"."earned" = true or "trophies"."earned_at" is null)
);
--> statement-breakpoint
CREATE TABLE "trophy_sets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trophy_sets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"np_communication_id" text NOT NULL,
	"np_service_name" text NOT NULL,
	"name" text NOT NULL,
	"platform" text,
	"icon_url" text,
	"defined_bronze" integer DEFAULT 0 NOT NULL,
	"defined_silver" integer DEFAULT 0 NOT NULL,
	"defined_gold" integer DEFAULT 0 NOT NULL,
	"defined_platinum" integer DEFAULT 0 NOT NULL,
	"earned_bronze" integer DEFAULT 0 NOT NULL,
	"earned_silver" integer DEFAULT 0 NOT NULL,
	"earned_gold" integer DEFAULT 0 NOT NULL,
	"earned_platinum" integer DEFAULT 0 NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp with time zone,
	"trophies_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trophy_sets_progress_check" CHECK ("trophy_sets"."progress" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "game_status" ADD CONSTRAINT "game_status_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_trophy_set_id_trophy_sets_id_fk" FOREIGN KEY ("trophy_set_id") REFERENCES "public"."trophy_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playtime_snapshots" ADD CONSTRAINT "playtime_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playtime_snapshots" ADD CONSTRAINT "playtime_snapshots_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophies" ADD CONSTRAINT "trophies_trophy_set_id_trophy_sets_id_fk" FOREIGN KEY ("trophy_set_id") REFERENCES "public"."trophy_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_status_status_idx" ON "game_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX "game_status_completed_at_idx" ON "game_status" USING btree ("completed_at") WHERE "game_status"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "game_status_dropped_at_idx" ON "game_status" USING btree ("dropped_at") WHERE "game_status"."dropped_at" is not null;--> statement-breakpoint
CREATE INDEX "game_trophy_sets_trophy_set_id_idx" ON "game_trophy_sets" USING btree ("trophy_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_title_id_key" ON "games" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX "games_concept_id_idx" ON "games" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "games_last_played_at_idx" ON "games" USING btree ("last_played_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip_hash","attempted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "playtime_snapshots_game_date_key" ON "playtime_snapshots" USING btree ("game_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "playtime_snapshots_date_idx" ON "playtime_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "sync_runs_started_at_idx" ON "sync_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_running_idx" ON "sync_runs" USING btree ((true)) WHERE "sync_runs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "trophies_set_trophy_key" ON "trophies" USING btree ("trophy_set_id","trophy_id");--> statement-breakpoint
CREATE INDEX "trophies_earned_at_idx" ON "trophies" USING btree ("earned_at") WHERE "trophies"."earned_at" is not null;--> statement-breakpoint
CREATE INDEX "trophies_set_earned_idx" ON "trophies" USING btree ("trophy_set_id","earned");--> statement-breakpoint
CREATE UNIQUE INDEX "trophy_sets_np_communication_id_key" ON "trophy_sets" USING btree ("np_communication_id");