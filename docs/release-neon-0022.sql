-- Миграция 0022 для Neon SQL Editor (без терминала). Фаза 32, контракт 17.1/17.3a: цель года в штуках.
-- Идемпотентно: можно запускать повторно. Что делает: добавляет в roadmap_settings две пустые колонки goal_mode, goal_count
-- и три CHECK-ограничения. Существующие строки и данные не меняются (expand: у всех цели нет).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код на старой схеме: цель отвечает 503, остальной план работает).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0022_roadmap_goal
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'telegram_chats') THEN
		RAISE EXCEPTION '0022: сначала применить release-neon-0021.sql (нет telegram_chats)';
	END IF;
END $$;

ALTER TABLE "roadmap_settings" ADD COLUMN IF NOT EXISTS "goal_mode" text;
ALTER TABLE "roadmap_settings" ADD COLUMN IF NOT EXISTS "goal_count" smallint;

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.roadmap_settings'::regclass AND conname = 'roadmap_settings_goal_mode_check') THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_goal_mode_check" CHECK ("roadmap_settings"."goal_mode" is null or "roadmap_settings"."goal_mode" in ('complete', 'backlog_to'));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.roadmap_settings'::regclass AND conname = 'roadmap_settings_goal_count_check') THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_goal_count_check" CHECK ("roadmap_settings"."goal_count" is null or ("roadmap_settings"."goal_count" >= 0 and "roadmap_settings"."goal_count" <= 1000));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.roadmap_settings'::regclass AND conname = 'roadmap_settings_goal_pair_check') THEN
		ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_goal_pair_check" CHECK (("roadmap_settings"."goal_mode" is null) = ("roadmap_settings"."goal_count" is null));
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
	('75d19bea6cb33949cbf2ceaacd908cb8e58316b234da42fa8b676f7154144714', 1793540167283::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roadmap_settings' AND column_name IN ('goal_mode', 'goal_count')) = 2 AS columns,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('roadmap_settings_goal_mode_check', 'roadmap_settings_goal_count_check', 'roadmap_settings_goal_pair_check')) = 3 AS constraints,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793540167283) = 1 AS journal_entry;
