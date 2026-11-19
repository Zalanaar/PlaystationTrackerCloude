-- Миграция 0015 для Neon SQL Editor (без терминала). Фаза 20.3, contract, контракт 22.7 (шаг 7) и 22.14.
-- Идемпотентно: можно запускать повторно. Что делает:
--   * psn_profile и roadmap_settings: PK становится user_id, колонка id удаляется (DATA LOSS намеренно: id всегда был 1);
--   * recommend_llm_usage, recommend_discover_cache: PK (user_id, day); recommend_reasons: PK (user_id, game_id, signals_hash); recommend_external_dislikes: PK (user_id, external_source, external_id);
--   * удаляет глобальные unique (games.title_id, trophy_sets.np_communication_id, trophies (set, trophy), playtime_snapshots (game, date),
--     planned_games (source, id)), дублирующие unique на user_id и устаревшие индексы без префикса user_id;
--   * снимает DEFAULT 1 с user_id во всех 19 таблицах (NOT NULL остаётся).
--   Данные строк не меняются и не удаляются. recommend_reasons: PK (user_id, game_id, signals_hash) вместо (game_id, signals_hash) (B-1, 22.14).
-- ПОСЛЕ ЭТОЙ МИГРАЦИИ код до Фазы 20.3 (до слоя userId) работать не будет, а откат схемы возможен только docs/release-neon-0015-rollback.sql
-- (и только пока данных других пользователей нет). Поэтому выкладывается отдельно от 0014, после суток наблюдения.
-- ПЕРЕД ЗАПУСКОМ:
--   1. «Скачать копию» разметки на сайте (Фаза 16.3) и сохранить файл.
--   2. Создать ветку Neon «before-0015» от текущего состояния (она же точка отката).
--   3. Запустить docs/release-neon-0015-check.sql и сохранить результат («до»).
-- ПОСЛЕ: снова docs/release-neon-0015-check.sql (строки с данными совпадают с «до», строки zz_* меняются 0 -> 1) и флаги в конце этого скрипта (все true).
-- Порядок: сначала этот скрипт, потом деплой кода 0015. Текущий прод-код (20.3) работает и на схеме после 0015, кроме записи кэша фраз
-- «Подскажи» (ON CONFLICT по старому PK): до деплоя нового кода она тихо не пишется (предупреждение шага LLM), данные не страдают.
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0015_user_id_contract
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'user_id') THEN
		RAISE EXCEPTION '0015: сначала применить docs/release-neon-0014.sql (нет games.user_id)';
	END IF;
END $$;

ALTER TABLE "psn_profile" DROP COLUMN IF EXISTS "id";
ALTER TABLE "roadmap_settings" DROP COLUMN IF EXISTS "id";
ALTER TABLE "recommend_llm_usage" DROP CONSTRAINT IF EXISTS "recommend_llm_usage_pkey";
ALTER TABLE "recommend_discover_cache" DROP CONSTRAINT IF EXISTS "recommend_discover_cache_pkey";
ALTER TABLE "recommend_external_dislikes" DROP CONSTRAINT IF EXISTS "recommend_external_dislikes_external_source_external_id_pk";
ALTER TABLE "recommend_reasons" DROP CONSTRAINT IF EXISTS "recommend_reasons_game_id_signals_hash_pk";

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psn_profile_user_id_pk' AND conrelid = 'public.psn_profile'::regclass) THEN
		ALTER TABLE "psn_profile" ADD CONSTRAINT "psn_profile_user_id_pk" PRIMARY KEY("user_id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_settings_user_id_pk' AND conrelid = 'public.roadmap_settings'::regclass) THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_user_id_pk" PRIMARY KEY("user_id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_llm_usage_user_id_day_pk' AND conrelid = 'public.recommend_llm_usage'::regclass) THEN
		ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_user_id_day_pk" PRIMARY KEY("user_id","day");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_discover_cache_user_id_day_pk' AND conrelid = 'public.recommend_discover_cache'::regclass) THEN
		ALTER TABLE "recommend_discover_cache" ADD CONSTRAINT "recommend_discover_cache_user_id_day_pk" PRIMARY KEY("user_id","day");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_external_dislikes_user_id_external_source_external_id_pk' AND conrelid = 'public.recommend_external_dislikes'::regclass) THEN
		ALTER TABLE "recommend_external_dislikes" ADD CONSTRAINT "recommend_external_dislikes_user_id_external_source_external_id_pk" PRIMARY KEY("user_id","external_source","external_id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_reasons_user_id_game_id_signals_hash_pk' AND conrelid = 'public.recommend_reasons'::regclass) THEN
		ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_user_id_game_id_signals_hash_pk" PRIMARY KEY("user_id","game_id","signals_hash");
	END IF;
END $$;

DROP INDEX IF EXISTS "games_title_id_key";
DROP INDEX IF EXISTS "trophy_sets_np_communication_id_key";
DROP INDEX IF EXISTS "trophies_set_trophy_key";
DROP INDEX IF EXISTS "playtime_snapshots_game_date_key";
DROP INDEX IF EXISTS "planned_games_external_key";
DROP INDEX IF EXISTS "psn_profile_user_key";
DROP INDEX IF EXISTS "roadmap_settings_user_key";
DROP INDEX IF EXISTS "recommend_llm_usage_user_day_key";
DROP INDEX IF EXISTS "recommend_discover_cache_user_day_key";
DROP INDEX IF EXISTS "recommend_external_dislikes_user_key";
DROP INDEX IF EXISTS "game_status_status_idx";
DROP INDEX IF EXISTS "games_concept_id_idx";
DROP INDEX IF EXISTS "games_last_played_at_idx";
DROP INDEX IF EXISTS "planned_games_status_idx";
DROP INDEX IF EXISTS "playtime_snapshots_date_idx";
DROP INDEX IF EXISTS "roadmap_order_position_idx";
DROP INDEX IF EXISTS "sync_runs_started_at_idx";
DROP INDEX IF EXISTS "trophies_earned_at_idx";

ALTER TABLE "game_month_exclusions" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "game_status" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "game_trophy_sets" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "games" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "planned_games" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "playtime_snapshots" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "psn_profile" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "recommend_discover_cache" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "recommend_dislikes" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "recommend_external_dislikes" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "recommend_llm_usage" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "recommend_reasons" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "roadmap_excluded" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "roadmap_order" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "roadmap_settings" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "status_backups" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "sync_runs" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "trophies" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "trophy_sets" ALTER COLUMN "user_id" DROP DEFAULT;

-- Журнал drizzle
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at bigint
);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
	('beaf80959609f55e43d2201bcee1d43b60c25f3422c8ecdaa313ea445679eba4', 1793442920169::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN ('psn_profile', 'roadmap_settings')) = 0 AS id_columns_dropped,
	(SELECT count(*) FROM pg_constraint WHERE contype = 'p' AND conname IN ('psn_profile_user_id_pk', 'roadmap_settings_user_id_pk', 'recommend_llm_usage_user_id_day_pk', 'recommend_discover_cache_user_id_day_pk', 'recommend_external_dislikes_user_id_external_source_external_id_pk', 'recommend_reasons_user_id_game_id_signals_hash_pk')) = 6 AS primary_keys,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('games_title_id_key', 'trophy_sets_np_communication_id_key', 'trophies_set_trophy_key', 'playtime_snapshots_game_date_key', 'planned_games_external_key', 'psn_profile_user_key', 'roadmap_settings_user_key', 'recommend_llm_usage_user_day_key', 'recommend_discover_cache_user_day_key', 'recommend_external_dislikes_user_key', 'game_status_status_idx', 'games_concept_id_idx', 'games_last_played_at_idx', 'planned_games_status_idx', 'playtime_snapshots_date_idx', 'roadmap_order_position_idx', 'sync_runs_started_at_idx', 'trophies_earned_at_idx')) = 0 AS old_indexes_gone,
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id' AND column_default IS NOT NULL AND table_name IN ('game_month_exclusions', 'game_status', 'game_trophy_sets', 'games', 'planned_games', 'playtime_snapshots', 'psn_profile', 'recommend_discover_cache', 'recommend_dislikes', 'recommend_external_dislikes', 'recommend_llm_usage', 'recommend_reasons', 'roadmap_excluded', 'roadmap_order', 'roadmap_settings', 'status_backups', 'sync_runs', 'trophies', 'trophy_sets')) = 0 AS no_user_id_defaults,
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id' AND is_nullable = 'NO' AND table_name IN ('game_month_exclusions', 'game_status', 'game_trophy_sets', 'games', 'planned_games', 'playtime_snapshots', 'psn_profile', 'recommend_discover_cache', 'recommend_dislikes', 'recommend_external_dislikes', 'recommend_llm_usage', 'recommend_reasons', 'roadmap_excluded', 'roadmap_order', 'roadmap_settings', 'status_backups', 'sync_runs', 'trophies', 'trophy_sets')) = 19 AS user_id_not_null;
