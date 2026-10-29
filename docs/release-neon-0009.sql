-- Миграция 0009 для Neon SQL Editor (без терминала). Правка Фазы 12, контракт 17.12.
-- Идемпотентно: можно запускать повторно. Только создаёт таблицу roadmap_excluded, существующие данные не затрагиваются.
-- Применять ПОСЛЕ docs/release-neon-0008.sql и ДО деплоя кода этой правки.
-- Последний блок записывает миграцию в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить её снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0009_roadmap_excluded
CREATE TABLE IF NOT EXISTS "roadmap_excluded" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_excluded_game_id_games_id_fk') THEN
		ALTER TABLE "roadmap_excluded" ADD CONSTRAINT "roadmap_excluded_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
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
	('47b3cb191958e1266e9febe92e65b0699ccc82591b9bb6644789c2668843bf1f', 1793263186828::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 10 (или 9, если 0000 ставили не через drizzle), оба флага true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'roadmap_excluded') = 1 AS excluded_table,
	(SELECT count(*) FROM pg_constraint WHERE conname = 'roadmap_excluded_game_id_games_id_fk') = 1 AS excluded_fk;
