-- Миграция 0018 для Neon SQL Editor (без терминала). Фаза 23, контракт 25: дубли игр.
-- Идемпотентно: можно запускать повторно. Что делает: добавляет в games колонки duplicate_of_game_id (nullable) и not_duplicate (boolean, default false),
-- составной FK на главную игру того же пользователя, CHECK «не сам на себя» и частичный индекс. Данные не удаляются (expand).
-- Порядок: сначала этот скрипт, потом деплой кода (старый код работает и на новой схеме, новый на старой падает).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0018_game_duplicates
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'user_id') THEN
		RAISE EXCEPTION '0018: сначала применить release-neon-0013.sql ... 0015.sql (нет games.user_id)';
	END IF;
END $$;

ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "duplicate_of_game_id" integer;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "not_duplicate" boolean DEFAULT false NOT NULL;

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.games'::regclass AND conname = 'games_duplicate_of_fk') THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_duplicate_of_fk" FOREIGN KEY ("user_id","duplicate_of_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "games_user_duplicate_of_idx" ON "games" USING btree ("user_id","duplicate_of_game_id") WHERE "games"."duplicate_of_game_id" is not null;

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.games'::regclass AND conname = 'games_duplicate_self_check') THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_duplicate_self_check" CHECK ("games"."duplicate_of_game_id" is null or "games"."duplicate_of_game_id" <> "games"."id");
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
	('3086acbd14529bcf513637e3765627d35f7417f653aa3092181192fd16f8154b', 1793480610527::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'duplicate_of_game_id' AND data_type = 'integer' AND is_nullable = 'YES' AND column_default IS NULL) = 1 AS duplicate_of_column,
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'games' AND column_name = 'not_duplicate' AND data_type = 'boolean' AND is_nullable = 'NO') = 1 AS not_duplicate_column,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.games'::regclass AND conname IN ('games_duplicate_of_fk', 'games_duplicate_self_check')) = 2 AS duplicate_constraints,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'games_user_duplicate_of_idx') = 1 AS duplicate_index,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793480610527) = 1 AS journal_entry;
