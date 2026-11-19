-- Миграция 0023 для Neon SQL Editor (без терминала). Фаза 32.1, контракт 8.8: остановка синка.
-- Идемпотентно: можно запускать повторно. Что делает: добавляет значение 'cancelled' в enum sync_error_reason.
-- Данные не меняются. Значение нельзя использовать в той же транзакции, где оно добавлено: скрипт его и не использует
-- (проверка ниже смотрит в pg_enum, а не приводит литерал к типу).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код на старой схеме: отмена и перезапуск синка отвечают 503; статус, health, обычный запуск и синк работают, `cancelled` сравнивается как текст).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0023_sync_cancelled
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roadmap_settings' AND column_name = 'goal_mode') THEN
		RAISE EXCEPTION '0023: сначала применить release-neon-0022.sql (нет roadmap_settings.goal_mode)';
	END IF;
END $$;

ALTER TYPE "public"."sync_error_reason" ADD VALUE IF NOT EXISTS 'cancelled';

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
	('a1882386211c515d62697bb67e4c7f2267869b427030f6a0dcf45961271cbcca', 1793544108496::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'sync_error_reason' AND e.enumlabel = 'cancelled') AS enum_value,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793544108496) = 1 AS journal_entry;
