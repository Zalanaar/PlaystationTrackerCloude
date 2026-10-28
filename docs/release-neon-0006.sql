-- Миграция 0006 для Neon SQL Editor (без терминала). Фаза 11, контракт 16.
-- Идемпотентно: можно запускать повторно. Только добавляет колонки, данные не теряются.
-- Применять ПОСЛЕ docs/release-neon-0004-0005.sql и ДО деплоя кода Фазы 11.
-- Последний блок записывает миграцию в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить её снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0006_hltb_duration
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "hltb_id" integer;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "hltb_name" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "hltb_main_hours" double precision;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "hltb_extra_hours" double precision;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "hltb_checked_at" timestamp with time zone;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "duration_override_hours" double precision;
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_hltb_main_check') THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_hltb_main_check" CHECK ("games"."hltb_main_hours" is null or "games"."hltb_main_hours" > 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_hltb_extra_check') THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_hltb_extra_check" CHECK ("games"."hltb_extra_hours" is null or "games"."hltb_extra_hours" > 0);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_duration_override_check') THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_duration_override_check" CHECK ("games"."duration_override_hours" is null or "games"."duration_override_hours" > 0);
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
	('66f4f500719883486951d4bfb2f13831e3c13f5178951f39f76a20ef30386b34', 1793211799430::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 7 (или 6, если 0000 ставили не через drizzle), все колонки true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT count(*) FROM information_schema.columns WHERE table_name = 'games' AND column_name IN ('hltb_id','hltb_name','hltb_main_hours','hltb_extra_hours','hltb_checked_at','duration_override_hours')) = 6 AS games_hltb_columns,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('games_hltb_main_check','games_hltb_extra_check','games_duration_override_check')) = 3 AS games_duration_checks;
