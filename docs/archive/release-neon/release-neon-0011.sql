-- Миграция 0011 для Neon SQL Editor (без терминала). Фаза 13b «Подскажи: Новое от ИИ», контракт 19.1.
-- Идемпотентно: можно запускать повторно. Только создаёт две таблицы (recommend_discover_cache, recommend_external_dislikes), существующие данные не затрагиваются.
-- Применять ПОСЛЕ docs/release-neon-0010.sql и ДО деплоя кода Фазы 13b: без таблиц GET /api/recommend/discover отвечает 503 db_unavailable.
-- Последний блок записывает миграцию в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить её снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0011_recommend_discover
CREATE TABLE IF NOT EXISTS "recommend_discover_cache" (
	"day" date PRIMARY KEY NOT NULL,
	"profile_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"refreshes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_discover_cache_refreshes_check" CHECK ("recommend_discover_cache"."refreshes" >= 0)
);

CREATE TABLE IF NOT EXISTS "recommend_external_dislikes" (
	"external_source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"cover_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_external_dislikes_external_source_external_id_pk" PRIMARY KEY("external_source","external_id"),
	CONSTRAINT "recommend_external_dislikes_source_check" CHECK ("recommend_external_dislikes"."external_source" = 'rawg'),
	CONSTRAINT "recommend_external_dislikes_title_check" CHECK (char_length("recommend_external_dislikes"."title") between 1 and 200)
);

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
	('d535aa9c66e771f5ba53c5625730b622b72a30c3b298136f179e4881fc6d5cc5', 1793280590693::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 12 (или 11, если 0000 ставили не через drizzle), оба флага true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('recommend_discover_cache', 'recommend_external_dislikes')) = 2 AS discover_tables,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('recommend_discover_cache_refreshes_check', 'recommend_external_dislikes_source_check', 'recommend_external_dislikes_title_check')) = 3 AS discover_checks;
