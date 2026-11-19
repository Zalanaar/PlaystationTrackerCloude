-- ОТКАТ миграции 0015 для Neon SQL Editor: возвращает схему к состоянию после 0014 (docs/release-neon-0014.sql). Идемпотентно.
-- Возможен без потери данных ТОЛЬКО пока в БД данные одного пользователя (owner, user_id = 1): иначе старые unique/PK по title_id,
-- np_communication_id и т. д. уже невозможны. В этом случае скрипт останавливается до изменений; восстановление = ветка Neon «before-0015» / PITR.
-- Что делает: возвращает psn_profile.id и roadmap_settings.id (smallint, default 1, PK, singleton CHECK), старые PK/unique/индексы
-- и DEFAULT 1 у user_id; удаляет запись 0015 из журнала drizzle. Затем задеплоить предыдущую версию кода (прод 20.3, `main` до коммита 0015):
-- она совместима со схемой после 0014 и после 0015. Код 0015 (ON CONFLICT кэша фраз по user_id) на схеме 0014 фразы не кэширует.
-- Данные не меняются. Колонки id получат значение 1 (в таблицах по одной строке на пользователя, строка owner одна).

DO $$ BEGIN
	IF (SELECT count(*) FROM "game_month_exclusions" WHERE "user_id" <> 1) + (SELECT count(*) FROM "game_status" WHERE "user_id" <> 1) + (SELECT count(*) FROM "game_trophy_sets" WHERE "user_id" <> 1) + (SELECT count(*) FROM "games" WHERE "user_id" <> 1) + (SELECT count(*) FROM "planned_games" WHERE "user_id" <> 1) + (SELECT count(*) FROM "playtime_snapshots" WHERE "user_id" <> 1) + (SELECT count(*) FROM "psn_profile" WHERE "user_id" <> 1) + (SELECT count(*) FROM "recommend_discover_cache" WHERE "user_id" <> 1) + (SELECT count(*) FROM "recommend_dislikes" WHERE "user_id" <> 1) + (SELECT count(*) FROM "recommend_external_dislikes" WHERE "user_id" <> 1) + (SELECT count(*) FROM "recommend_llm_usage" WHERE "user_id" <> 1) + (SELECT count(*) FROM "recommend_reasons" WHERE "user_id" <> 1) + (SELECT count(*) FROM "roadmap_excluded" WHERE "user_id" <> 1) + (SELECT count(*) FROM "roadmap_order" WHERE "user_id" <> 1) + (SELECT count(*) FROM "roadmap_settings" WHERE "user_id" <> 1) + (SELECT count(*) FROM "status_backups" WHERE "user_id" <> 1) + (SELECT count(*) FROM "sync_runs" WHERE "user_id" <> 1) + (SELECT count(*) FROM "trophies" WHERE "user_id" <> 1) + (SELECT count(*) FROM "trophy_sets" WHERE "user_id" <> 1) > 0 THEN
		RAISE EXCEPTION '0015 rollback: есть данные не владельца (user_id <> 1); откат невозможен, восстановить из ветки Neon before-0015';
	END IF;
	IF (SELECT count(*) FROM "psn_profile") > 1 OR (SELECT count(*) FROM "roadmap_settings") > 1 THEN
		RAISE EXCEPTION '0015 rollback: в psn_profile/roadmap_settings больше одной строки';
	END IF;
END $$;

ALTER TABLE "psn_profile" ADD COLUMN IF NOT EXISTS "id" smallint DEFAULT 1 NOT NULL;
ALTER TABLE "roadmap_settings" ADD COLUMN IF NOT EXISTS "id" smallint DEFAULT 1 NOT NULL;
ALTER TABLE "psn_profile" DROP CONSTRAINT IF EXISTS "psn_profile_user_id_pk";
ALTER TABLE "roadmap_settings" DROP CONSTRAINT IF EXISTS "roadmap_settings_user_id_pk";
ALTER TABLE "recommend_llm_usage" DROP CONSTRAINT IF EXISTS "recommend_llm_usage_user_id_day_pk";
ALTER TABLE "recommend_discover_cache" DROP CONSTRAINT IF EXISTS "recommend_discover_cache_user_id_day_pk";
ALTER TABLE "recommend_external_dislikes" DROP CONSTRAINT IF EXISTS "recommend_external_dislikes_user_id_external_source_external_id_pk";
ALTER TABLE "recommend_reasons" DROP CONSTRAINT IF EXISTS "recommend_reasons_user_id_game_id_signals_hash_pk";

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psn_profile_pkey' AND conrelid = 'public.psn_profile'::regclass) THEN
		ALTER TABLE "psn_profile" ADD CONSTRAINT "psn_profile_pkey" PRIMARY KEY ("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psn_profile_singleton_check' AND conrelid = 'public.psn_profile'::regclass) THEN
		ALTER TABLE "psn_profile" ADD CONSTRAINT "psn_profile_singleton_check" CHECK ("psn_profile"."id" = 1);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_settings_pkey' AND conrelid = 'public.roadmap_settings'::regclass) THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_pkey" PRIMARY KEY ("id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_settings_singleton_check' AND conrelid = 'public.roadmap_settings'::regclass) THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_singleton_check" CHECK ("roadmap_settings"."id" = 1);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_llm_usage_pkey' AND conrelid = 'public.recommend_llm_usage'::regclass) THEN
		ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_pkey" PRIMARY KEY ("day");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_discover_cache_pkey' AND conrelid = 'public.recommend_discover_cache'::regclass) THEN
		ALTER TABLE "recommend_discover_cache" ADD CONSTRAINT "recommend_discover_cache_pkey" PRIMARY KEY ("day");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_external_dislikes_external_source_external_id_pk' AND conrelid = 'public.recommend_external_dislikes'::regclass) THEN
		ALTER TABLE "recommend_external_dislikes" ADD CONSTRAINT "recommend_external_dislikes_external_source_external_id_pk" PRIMARY KEY ("external_source","external_id");
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_reasons_game_id_signals_hash_pk' AND conrelid = 'public.recommend_reasons'::regclass) THEN
		ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_game_id_signals_hash_pk" PRIMARY KEY ("game_id","signals_hash");
	END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "games_title_id_key" ON "games" USING btree ("title_id");
CREATE UNIQUE INDEX IF NOT EXISTS "trophy_sets_np_communication_id_key" ON "trophy_sets" USING btree ("np_communication_id");
CREATE UNIQUE INDEX IF NOT EXISTS "trophies_set_trophy_key" ON "trophies" USING btree ("trophy_set_id","trophy_id");
CREATE UNIQUE INDEX IF NOT EXISTS "playtime_snapshots_game_date_key" ON "playtime_snapshots" USING btree ("game_id","snapshot_date");
CREATE UNIQUE INDEX IF NOT EXISTS "planned_games_external_key" ON "planned_games" USING btree ("external_source","external_id") WHERE "planned_games"."external_id" is not null;
CREATE UNIQUE INDEX IF NOT EXISTS "psn_profile_user_key" ON "psn_profile" USING btree ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "roadmap_settings_user_key" ON "roadmap_settings" USING btree ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "recommend_llm_usage_user_day_key" ON "recommend_llm_usage" USING btree ("user_id","day");
CREATE UNIQUE INDEX IF NOT EXISTS "recommend_discover_cache_user_day_key" ON "recommend_discover_cache" USING btree ("user_id","day");
CREATE UNIQUE INDEX IF NOT EXISTS "recommend_external_dislikes_user_key" ON "recommend_external_dislikes" USING btree ("user_id","external_source","external_id");
CREATE INDEX IF NOT EXISTS "game_status_status_idx" ON "game_status" USING btree ("status");
CREATE INDEX IF NOT EXISTS "games_concept_id_idx" ON "games" USING btree ("concept_id");
CREATE INDEX IF NOT EXISTS "games_last_played_at_idx" ON "games" USING btree ("last_played_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "planned_games_status_idx" ON "planned_games" USING btree ("status");
CREATE INDEX IF NOT EXISTS "playtime_snapshots_date_idx" ON "playtime_snapshots" USING btree ("snapshot_date");
CREATE INDEX IF NOT EXISTS "roadmap_order_position_idx" ON "roadmap_order" USING btree ("position");
CREATE INDEX IF NOT EXISTS "sync_runs_started_at_idx" ON "sync_runs" USING btree ("started_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "trophies_earned_at_idx" ON "trophies" USING btree ("earned_at") WHERE "trophies"."earned_at" is not null;

ALTER TABLE "game_month_exclusions" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "game_status" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "game_trophy_sets" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "games" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "planned_games" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "playtime_snapshots" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "psn_profile" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "recommend_discover_cache" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "recommend_dislikes" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "recommend_external_dislikes" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "recommend_llm_usage" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "recommend_reasons" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "roadmap_excluded" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "roadmap_order" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "roadmap_settings" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "status_backups" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "sync_runs" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "trophies" ALTER COLUMN "user_id" SET DEFAULT 1;
ALTER TABLE "trophy_sets" ALTER COLUMN "user_id" SET DEFAULT 1;

-- Журнал drizzle: 0015 снова считается неприменённой
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793442920169::bigint;

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id' AND table_name IN ('psn_profile', 'roadmap_settings')) = 2 AS id_columns_back,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('psn_profile_pkey', 'roadmap_settings_pkey', 'recommend_llm_usage_pkey', 'recommend_discover_cache_pkey', 'recommend_external_dislikes_external_source_external_id_pk', 'recommend_reasons_game_id_signals_hash_pk')) = 6 AS old_primary_keys,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793442920169::bigint) = 0 AS journal_clean;
