-- Миграция 0017 для Neon SQL Editor (без терминала). Хвост 20.5 (B-4), контракт 24: счётчики RAWG и HLTB по пользователям.
-- Идемпотентно: можно запускать повторно. Что делает: создаёт новую таблицу provider_usage (user_id, day, provider, calls). Существующие таблицы и данные не трогает (expand).
-- Порядок: лучше этот скрипт ДО деплоя кода. Код без таблицы не падает (fail-open: лимиты тогда считаются в памяти процесса).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0017_provider_usage
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'allowed_users') THEN
		RAISE EXCEPTION '0017: сначала применить docs/release-neon-0013.sql (нет allowed_users)';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS "provider_usage" (
	"user_id" integer NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_usage_user_id_day_provider_pk" PRIMARY KEY("user_id","day","provider"),
	CONSTRAINT "provider_usage_provider_check" CHECK ("provider_usage"."provider" in ('rawg', 'hltb')),
	CONSTRAINT "provider_usage_calls_check" CHECK ("provider_usage"."calls" >= 0)
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_usage_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
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
	('7b5eaa41947a30b9c77bd8e30c9ba87f5b74c3fe3b1e03419ad0080481d66fec', 1793463830830::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_usage') = 4 AS provider_usage_columns,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.provider_usage'::regclass AND conname IN ('provider_usage_user_id_day_provider_pk', 'provider_usage_provider_check', 'provider_usage_calls_check', 'provider_usage_user_id_allowed_users_id_fk')) = 4 AS provider_usage_constraints,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793463830830) = 1 AS journal_entry;
