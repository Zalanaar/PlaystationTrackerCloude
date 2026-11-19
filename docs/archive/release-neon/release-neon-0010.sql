-- Миграция 0010 для Neon SQL Editor (без терминала). Фаза 13 «Подскажи», контракт 18.7.
-- Идемпотентно: можно запускать повторно. Только создаёт три таблицы (recommend_dislikes, recommend_reasons, recommend_llm_usage), существующие данные не затрагиваются.
-- Применять ПОСЛЕ docs/release-neon-0009.sql и ДО деплоя кода Фазы 13: без таблиц GET /api/recommend отвечает 503 db_unavailable.
-- Последний блок записывает миграцию в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить её снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0010_recommend
CREATE TABLE IF NOT EXISTS "recommend_dislikes" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "recommend_llm_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recommend_llm_usage_calls_check" CHECK ("recommend_llm_usage"."calls" >= 0)
);

CREATE TABLE IF NOT EXISTS "recommend_reasons" (
	"game_id" integer NOT NULL,
	"signals_hash" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_reasons_game_id_signals_hash_pk" PRIMARY KEY("game_id","signals_hash"),
	CONSTRAINT "recommend_reasons_text_check" CHECK (char_length("recommend_reasons"."text") between 1 and 400)
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_dislikes_game_id_games_id_fk') THEN
		ALTER TABLE "recommend_dislikes" ADD CONSTRAINT "recommend_dislikes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recommend_reasons_game_id_games_id_fk') THEN
		ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
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
	('8e8f8b8a951d0e7b64737f996d6bf91bc8fc543d89c9d12d48d5667a125ffd41', 1793276110945::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 11 (или 10, если 0000 ставили не через drizzle), все три флага true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('recommend_dislikes', 'recommend_reasons', 'recommend_llm_usage')) = 3 AS recommend_tables,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('recommend_dislikes_game_id_games_id_fk', 'recommend_reasons_game_id_games_id_fk')) = 2 AS recommend_fks,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('recommend_reasons_text_check', 'recommend_llm_usage_calls_check')) = 2 AS recommend_checks;
