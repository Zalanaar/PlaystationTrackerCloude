-- 0015 (contract, Фаза 20, контракт 22.7 шаг 7 и 22.14). Необратима без docs/release-neon-0015-rollback.sql.
-- DATA LOSS (намеренно): колонки psn_profile.id и roadmap_settings.id (значение всегда 1, одна строка = один пользователь).
ALTER TABLE "psn_profile" DROP COLUMN "id";
--> statement-breakpoint
ALTER TABLE "roadmap_settings" DROP COLUMN "id";
--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" DROP CONSTRAINT "recommend_llm_usage_pkey";
--> statement-breakpoint
ALTER TABLE "recommend_discover_cache" DROP CONSTRAINT "recommend_discover_cache_pkey";
--> statement-breakpoint
ALTER TABLE "recommend_external_dislikes" DROP CONSTRAINT "recommend_external_dislikes_external_source_external_id_pk";
--> statement-breakpoint
ALTER TABLE "recommend_reasons" DROP CONSTRAINT "recommend_reasons_game_id_signals_hash_pk";
--> statement-breakpoint
ALTER TABLE "psn_profile" ADD CONSTRAINT "psn_profile_user_id_pk" PRIMARY KEY("user_id");
--> statement-breakpoint
ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_user_id_pk" PRIMARY KEY("user_id");
--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_user_id_day_pk" PRIMARY KEY("user_id","day");
--> statement-breakpoint
ALTER TABLE "recommend_discover_cache" ADD CONSTRAINT "recommend_discover_cache_user_id_day_pk" PRIMARY KEY("user_id","day");
--> statement-breakpoint
ALTER TABLE "recommend_external_dislikes" ADD CONSTRAINT "recommend_external_dislikes_user_id_external_source_external_id_pk" PRIMARY KEY("user_id","external_source","external_id");
--> statement-breakpoint
ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_user_id_game_id_signals_hash_pk" PRIMARY KEY("user_id","game_id","signals_hash");
--> statement-breakpoint
DROP INDEX "games_title_id_key";
--> statement-breakpoint
DROP INDEX "trophy_sets_np_communication_id_key";
--> statement-breakpoint
DROP INDEX "trophies_set_trophy_key";
--> statement-breakpoint
DROP INDEX "playtime_snapshots_game_date_key";
--> statement-breakpoint
DROP INDEX "planned_games_external_key";
--> statement-breakpoint
DROP INDEX "psn_profile_user_key";
--> statement-breakpoint
DROP INDEX "roadmap_settings_user_key";
--> statement-breakpoint
DROP INDEX "recommend_llm_usage_user_day_key";
--> statement-breakpoint
DROP INDEX "recommend_discover_cache_user_day_key";
--> statement-breakpoint
DROP INDEX "recommend_external_dislikes_user_key";
--> statement-breakpoint
DROP INDEX "game_status_status_idx";
--> statement-breakpoint
DROP INDEX "games_concept_id_idx";
--> statement-breakpoint
DROP INDEX "games_last_played_at_idx";
--> statement-breakpoint
DROP INDEX "planned_games_status_idx";
--> statement-breakpoint
DROP INDEX "playtime_snapshots_date_idx";
--> statement-breakpoint
DROP INDEX "roadmap_order_position_idx";
--> statement-breakpoint
DROP INDEX "sync_runs_started_at_idx";
--> statement-breakpoint
DROP INDEX "trophies_earned_at_idx";
--> statement-breakpoint
ALTER TABLE "game_month_exclusions" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "game_status" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "planned_games" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "playtime_snapshots" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "psn_profile" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "recommend_discover_cache" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "recommend_dislikes" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "recommend_external_dislikes" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "recommend_reasons" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "roadmap_excluded" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "roadmap_order" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "roadmap_settings" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "status_backups" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "sync_runs" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "trophies" ALTER COLUMN "user_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "trophy_sets" ALTER COLUMN "user_id" DROP DEFAULT;
