-- Миграция 0014 для Neon SQL Editor (без терминала). Фаза 20.3, expand, контракт 22.7 (шаг 4).
-- Идемпотентно: можно запускать повторно. Только добавляет: колонку user_id (default 1 = owner) в 19 таблиц данных и составные
-- уникальные ключи/индексы/внешние ключи рядом со старыми. Старые ключи и PK остаются, данные не теряются и не меняются
-- (все существующие строки получают user_id = 1). Предыдущая версия кода после этой миграции продолжает работать.
-- ПЕРЕД ЗАПУСКОМ:
--   1. «Скачать копию» разметки на сайте (Фаза 16.3) и сохранить файл.
--   2. Создать ветку Neon «before-0014» от текущего состояния.
--   3. Запустить docs/release-neon-0014-check.sql и сохранить результат (контрольные значения «до»).
-- Применять ПОСЛЕ docs/release-neon-0013.sql и docs/release-neon-0013-owner.sql (нужен owner с id = 1; без него блок-проверка
-- остановит скрипт с понятной ошибкой до любых изменений). Затем снова docs/release-neon-0014-check.sql: результат «после» должен совпасть с «до».
-- Деплой кода со слоем scope — только ПОСЛЕ этой миграции. Миграция 0015 (contract) — отдельно, не сейчас.
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0014_user_id_expand
DO $$ BEGIN
	-- 0014 подставляет user_id = 1 (owner, гарантирован db:bootstrap-owner). Есть данные, а owner с id = 1 нет: останавливаемся до любых изменений.
	IF NOT EXISTS (SELECT 1 FROM "allowed_users" WHERE "id" = 1 AND "role" = 'owner')
		AND (SELECT count(*) FROM "games") + (SELECT count(*) FROM "sync_runs") + (SELECT count(*) FROM "psn_profile") + (SELECT count(*) FROM "roadmap_settings") + (SELECT count(*) FROM "planned_games") + (SELECT count(*) FROM "status_backups") + (SELECT count(*) FROM "recommend_llm_usage") + (SELECT count(*) FROM "recommend_discover_cache") + (SELECT count(*) FROM "recommend_external_dislikes") > 0 THEN
		RAISE EXCEPTION '0014: owner (allowed_users.id = 1, role = owner) не найден; сначала docs/release-neon-0013-owner.sql';
	END IF;
END $$;

ALTER TABLE "psn_profile" ALTER COLUMN "id" SET DEFAULT 1;
ALTER TABLE "roadmap_settings" ALTER COLUMN "id" SET DEFAULT 1;
ALTER TABLE "game_month_exclusions" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "game_status" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "game_trophy_sets" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "planned_games" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "playtime_snapshots" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "psn_profile" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "recommend_discover_cache" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "recommend_dislikes" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "recommend_external_dislikes" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "recommend_llm_usage" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "recommend_reasons" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "roadmap_excluded" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "roadmap_order" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "roadmap_settings" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "status_backups" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "sync_runs" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "trophies" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "trophy_sets" ADD COLUMN IF NOT EXISTS "user_id" integer DEFAULT 1 NOT NULL;

CREATE INDEX IF NOT EXISTS "game_status_user_status_idx" ON "game_status" USING btree ("user_id","status");
CREATE INDEX IF NOT EXISTS "game_trophy_sets_user_game_idx" ON "game_trophy_sets" USING btree ("user_id","game_id");
CREATE UNIQUE INDEX IF NOT EXISTS "games_user_title_id_key" ON "games" USING btree ("user_id","title_id");
CREATE UNIQUE INDEX IF NOT EXISTS "games_user_id_id_key" ON "games" USING btree ("user_id","id");
CREATE INDEX IF NOT EXISTS "games_user_concept_id_idx" ON "games" USING btree ("user_id","concept_id");
CREATE INDEX IF NOT EXISTS "games_user_last_played_at_idx" ON "games" USING btree ("user_id","last_played_at" DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS "planned_games_user_external_key" ON "planned_games" USING btree ("user_id","external_source","external_id") WHERE "planned_games"."external_id" is not null;
CREATE INDEX IF NOT EXISTS "planned_games_user_status_idx" ON "planned_games" USING btree ("user_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "playtime_snapshots_user_game_date_key" ON "playtime_snapshots" USING btree ("user_id","game_id","snapshot_date");
CREATE INDEX IF NOT EXISTS "playtime_snapshots_user_date_idx" ON "playtime_snapshots" USING btree ("user_id","snapshot_date");
CREATE UNIQUE INDEX IF NOT EXISTS "psn_profile_user_key" ON "psn_profile" USING btree ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "recommend_discover_cache_user_day_key" ON "recommend_discover_cache" USING btree ("user_id","day");
CREATE UNIQUE INDEX IF NOT EXISTS "recommend_external_dislikes_user_key" ON "recommend_external_dislikes" USING btree ("user_id","external_source","external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "recommend_llm_usage_user_day_key" ON "recommend_llm_usage" USING btree ("user_id","day");
CREATE INDEX IF NOT EXISTS "roadmap_order_user_position_idx" ON "roadmap_order" USING btree ("user_id","position");
CREATE UNIQUE INDEX IF NOT EXISTS "roadmap_settings_user_key" ON "roadmap_settings" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "status_backups_user_created_idx" ON "status_backups" USING btree ("user_id","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "sync_runs_user_started_at_idx" ON "sync_runs" USING btree ("user_id","started_at" DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS "trophies_user_set_trophy_key" ON "trophies" USING btree ("user_id","trophy_set_id","trophy_id");
CREATE INDEX IF NOT EXISTS "trophies_user_earned_at_idx" ON "trophies" USING btree ("user_id","earned_at") WHERE "trophies"."earned_at" is not null;
CREATE UNIQUE INDEX IF NOT EXISTS "trophy_sets_user_np_key" ON "trophy_sets" USING btree ("user_id","np_communication_id");
CREATE UNIQUE INDEX IF NOT EXISTS "trophy_sets_user_id_id_key" ON "trophy_sets" USING btree ("user_id","id");

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_month_exclusions_user_id_allowed_users_id_fk' AND conrelid = 'public.game_month_exclusions'::regclass) THEN
		ALTER TABLE "game_month_exclusions" ADD CONSTRAINT "game_month_exclusions_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_month_exclusions_user_game_fk' AND conrelid = 'public.game_month_exclusions'::regclass) THEN
		ALTER TABLE "game_month_exclusions" ADD CONSTRAINT "game_month_exclusions_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_status_user_id_allowed_users_id_fk' AND conrelid = 'public.game_status'::regclass) THEN
		ALTER TABLE "game_status" ADD CONSTRAINT "game_status_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_status_user_game_fk' AND conrelid = 'public.game_status'::regclass) THEN
		ALTER TABLE "game_status" ADD CONSTRAINT "game_status_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_trophy_sets_user_id_allowed_users_id_fk' AND conrelid = 'public.game_trophy_sets'::regclass) THEN
		ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_trophy_sets_user_game_fk' AND conrelid = 'public.game_trophy_sets'::regclass) THEN
		ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_trophy_sets_user_set_fk' AND conrelid = 'public.game_trophy_sets'::regclass) THEN
		ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_user_id_allowed_users_id_fk' AND conrelid = 'public.games'::regclass) THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planned_games_user_id_allowed_users_id_fk' AND conrelid = 'public.planned_games'::regclass) THEN
		ALTER TABLE "planned_games" ADD CONSTRAINT "planned_games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'playtime_snapshots_user_id_allowed_users_id_fk' AND conrelid = 'public.playtime_snapshots'::regclass) THEN
		ALTER TABLE "playtime_snapshots" ADD CONSTRAINT "playtime_snapshots_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'playtime_snapshots_user_game_fk' AND conrelid = 'public.playtime_snapshots'::regclass) THEN
		ALTER TABLE "playtime_snapshots" ADD CONSTRAINT "playtime_snapshots_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psn_profile_user_id_allowed_users_id_fk' AND conrelid = 'public.psn_profile'::regclass) THEN
		ALTER TABLE "psn_profile" ADD CONSTRAINT "psn_profile_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_discover_cache_user_id_allowed_users_id_fk' AND conrelid = 'public.recommend_discover_cache'::regclass) THEN
		ALTER TABLE "recommend_discover_cache" ADD CONSTRAINT "recommend_discover_cache_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_dislikes_user_id_allowed_users_id_fk' AND conrelid = 'public.recommend_dislikes'::regclass) THEN
		ALTER TABLE "recommend_dislikes" ADD CONSTRAINT "recommend_dislikes_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_dislikes_user_game_fk' AND conrelid = 'public.recommend_dislikes'::regclass) THEN
		ALTER TABLE "recommend_dislikes" ADD CONSTRAINT "recommend_dislikes_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_external_dislikes_user_id_allowed_users_id_fk' AND conrelid = 'public.recommend_external_dislikes'::regclass) THEN
		ALTER TABLE "recommend_external_dislikes" ADD CONSTRAINT "recommend_external_dislikes_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_llm_usage_user_id_allowed_users_id_fk' AND conrelid = 'public.recommend_llm_usage'::regclass) THEN
		ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_reasons_user_id_allowed_users_id_fk' AND conrelid = 'public.recommend_reasons'::regclass) THEN
		ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_reasons_user_game_fk' AND conrelid = 'public.recommend_reasons'::regclass) THEN
		ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_excluded_user_id_allowed_users_id_fk' AND conrelid = 'public.roadmap_excluded'::regclass) THEN
		ALTER TABLE "roadmap_excluded" ADD CONSTRAINT "roadmap_excluded_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_excluded_user_game_fk' AND conrelid = 'public.roadmap_excluded'::regclass) THEN
		ALTER TABLE "roadmap_excluded" ADD CONSTRAINT "roadmap_excluded_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_order_user_id_allowed_users_id_fk' AND conrelid = 'public.roadmap_order'::regclass) THEN
		ALTER TABLE "roadmap_order" ADD CONSTRAINT "roadmap_order_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_order_user_game_fk' AND conrelid = 'public.roadmap_order'::regclass) THEN
		ALTER TABLE "roadmap_order" ADD CONSTRAINT "roadmap_order_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_settings_user_id_allowed_users_id_fk' AND conrelid = 'public.roadmap_settings'::regclass) THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'status_backups_user_id_allowed_users_id_fk' AND conrelid = 'public.status_backups'::regclass) THEN
		ALTER TABLE "status_backups" ADD CONSTRAINT "status_backups_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_runs_user_id_allowed_users_id_fk' AND conrelid = 'public.sync_runs'::regclass) THEN
		ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trophies_user_id_allowed_users_id_fk' AND conrelid = 'public.trophies'::regclass) THEN
		ALTER TABLE "trophies" ADD CONSTRAINT "trophies_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trophies_user_set_fk' AND conrelid = 'public.trophies'::regclass) THEN
		ALTER TABLE "trophies" ADD CONSTRAINT "trophies_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trophy_sets_user_id_allowed_users_id_fk' AND conrelid = 'public.trophy_sets'::regclass) THEN
		ALTER TABLE "trophy_sets" ADD CONSTRAINT "trophy_sets_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

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
	('533598a184155b78f30ccb7082b47bfae9d20b15fc895f7b6eb9205c75cd3011', 1793435308828::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id' AND table_name IN ('games', 'game_status', 'trophy_sets', 'game_trophy_sets', 'trophies', 'playtime_snapshots', 'sync_runs', 'psn_profile', 'status_backups', 'game_month_exclusions', 'roadmap_settings', 'planned_games', 'roadmap_order', 'roadmap_excluded', 'recommend_dislikes', 'recommend_reasons', 'recommend_llm_usage', 'recommend_discover_cache', 'recommend_external_dislikes')) = 19 AS user_id_columns,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('games_user_title_id_key', 'games_user_id_id_key', 'trophy_sets_user_np_key', 'trophy_sets_user_id_id_key', 'trophies_user_set_trophy_key', 'playtime_snapshots_user_game_date_key', 'psn_profile_user_key', 'roadmap_settings_user_key', 'planned_games_user_external_key', 'recommend_llm_usage_user_day_key', 'recommend_discover_cache_user_day_key', 'recommend_external_dislikes_user_key')) = 12 AS unique_keys,
	(SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.allowed_users'::regclass AND conrelid::regclass::text IN ('games', 'game_status', 'trophy_sets', 'game_trophy_sets', 'trophies', 'playtime_snapshots', 'sync_runs', 'psn_profile', 'status_backups', 'game_month_exclusions', 'roadmap_settings', 'planned_games', 'roadmap_order', 'roadmap_excluded', 'recommend_dislikes', 'recommend_reasons', 'recommend_llm_usage', 'recommend_discover_cache', 'recommend_external_dislikes')) = 19 AS user_id_fks,
	(SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%_user_%_fk' AND conname NOT LIKE '%allowed_users%') = 10 AS composite_fks;
