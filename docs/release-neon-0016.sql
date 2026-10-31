-- Миграция 0016 для Neon SQL Editor (без терминала). Фаза 21, прогресс тура, контракт 23.2.
-- Идемпотентно: можно запускать повторно. Что делает: добавляет в allowed_users две nullable-колонки
-- tour_version (integer) и tour_completed_at (timestamptz); существующим строкам один раз ставит tour_version = 1 (тур им не навязывается). Данные не удаляются (expand).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код читает эти колонки; старый код работает и на новой схеме).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0016_tour_progress
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'allowed_users') THEN
		RAISE EXCEPTION '0016: сначала применить docs/release-neon-0013.sql (нет allowed_users)';
	END IF;
END $$;

-- Решение продакта: существующим пользователям (в т.ч. owner) тур не навязываем. Строки, существовавшие на момент выкладки,
-- получают tour_version = 1 и tour_completed_at = now() ОДИН раз: только в запуске, который добавляет колонку tour_version.
-- Повторный запуск колонки уже не добавляет и новых пользователей не трогает.
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'tour_version') THEN
		ALTER TABLE "allowed_users" ADD COLUMN "tour_version" integer;
		ALTER TABLE "allowed_users" ADD COLUMN IF NOT EXISTS "tour_completed_at" timestamp with time zone;
		UPDATE "allowed_users" SET "tour_version" = 1, "tour_completed_at" = now() WHERE "tour_version" IS NULL;
	END IF;
END $$;
ALTER TABLE "allowed_users" ADD COLUMN IF NOT EXISTS "tour_completed_at" timestamp with time zone;

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
	('05d7212911cf3bcbff646d540d46a4c06d21980926ef5f774fac3eb765d132a8', 1793458056861::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'tour_version' AND data_type = 'integer' AND is_nullable = 'YES' AND column_default IS NULL) = 1 AS tour_version_column,
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'tour_completed_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES' AND column_default IS NULL) = 1 AS tour_completed_at_column,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793458056861) = 1 AS journal_entry,
	(SELECT count(*) FROM allowed_users WHERE tour_version IS NULL) = 0 AS existing_users_marked;
