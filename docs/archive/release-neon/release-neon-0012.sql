-- Миграция 0012 для Neon SQL Editor (без терминала). Этап 5, Фаза 16.4 «Расход LLM», контракт 20.9.
-- Идемпотентно: можно запускать повторно. Только добавляет (3 колонки счётчиков и таблицу recommend_llm_state), данные не теряются.
-- Применять ПОСЛЕ docs/release-neon-0011.sql и ДО деплоя кода Этапа 5: без колонок и таблицы GET /api/recommend,
-- шаг синка LLM и discover ?refresh=1 отвечают ошибкой БД (шаг синка только предупреждением).
-- Последний блок записывает миграцию в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить её снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0012_llm_budget
CREATE TABLE IF NOT EXISTS "recommend_llm_state" (
	"id" smallint PRIMARY KEY NOT NULL,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"last_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_llm_state_singleton_check" CHECK ("recommend_llm_state"."id" = 1),
	CONSTRAINT "recommend_llm_state_streak_check" CHECK ("recommend_llm_state"."fail_streak" >= 0)
);

ALTER TABLE "recommend_llm_usage" ADD COLUMN IF NOT EXISTS "phrase_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "recommend_llm_usage" ADD COLUMN IF NOT EXISTS "discover_auto_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "recommend_llm_usage" ADD COLUMN IF NOT EXISTS "discover_manual_calls" integer DEFAULT 0 NOT NULL;
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_llm_usage_phrase_calls_check') THEN
		ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_phrase_calls_check" CHECK ("recommend_llm_usage"."phrase_calls" >= 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_llm_usage_discover_auto_calls_check') THEN
		ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_discover_auto_calls_check" CHECK ("recommend_llm_usage"."discover_auto_calls" >= 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_llm_usage_discover_manual_calls_check') THEN
		ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_discover_manual_calls_check" CHECK ("recommend_llm_usage"."discover_manual_calls" >= 0);
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
	('e8226b625b83567144d351e3936aec1c07dc12212b837ea0ca0d1fb2cc74869d', 1793292426485::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 13 (или 12, если 0000 ставили не через drizzle), все флаги true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'recommend_llm_state') = 1 AS state_table,
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recommend_llm_usage' AND column_name IN ('phrase_calls', 'discover_auto_calls', 'discover_manual_calls')) = 3 AS usage_columns,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('recommend_llm_state_singleton_check', 'recommend_llm_state_streak_check', 'recommend_llm_usage_phrase_calls_check', 'recommend_llm_usage_discover_auto_calls_check', 'recommend_llm_usage_discover_manual_calls_check')) = 5 AS llm_checks;
