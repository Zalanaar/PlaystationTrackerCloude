-- Миграция 0024 для Neon SQL Editor (без терминала). Фаза 40, контракт 40.1: таблица owned_marks («Уже есть / проходил»).
-- Идемпотентно: можно запускать повторно. Что делает: создаёт таблицу owned_marks (PK user_id + rawg_id, CHECK по названию и по covered/completed,
-- внешние ключи на allowed_users и games (user_id, id), ON DELETE CASCADE) и индекс по покрывающей игре. Данные других таблиц не меняются (expand).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код на старой схеме: отметки отвечают 503, подборка «У тебя нет» и План работают без них).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0024_owned_marks
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'sync_error_reason' AND e.enumlabel = 'cancelled') THEN
		RAISE EXCEPTION '0024: сначала применить release-neon-0023.sql (нет значения cancelled в sync_error_reason)';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS "owned_marks" (
	"user_id" integer NOT NULL,
	"rawg_id" text NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"cover_url" text,
	"covered_by_game_id" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owned_marks_user_id_rawg_id_pk" PRIMARY KEY("user_id","rawg_id"),
	CONSTRAINT "owned_marks_title_check" CHECK (char_length("owned_marks"."title") between 1 and 200),
	CONSTRAINT "owned_marks_covered_completed" CHECK ("owned_marks"."covered_by_game_id" is null or "owned_marks"."completed" = false)
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.owned_marks'::regclass AND conname = 'owned_marks_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "owned_marks" ADD CONSTRAINT "owned_marks_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.owned_marks'::regclass AND conname = 'owned_marks_user_game_fk') THEN
		ALTER TABLE "owned_marks" ADD CONSTRAINT "owned_marks_user_game_fk" FOREIGN KEY ("user_id","covered_by_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "owned_marks_user_covered_idx" ON "owned_marks" USING btree ("user_id","covered_by_game_id") WHERE "owned_marks"."covered_by_game_id" is not null;

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
	('2aa013a6a3bf93dcc774705fdb52d76fa54d1f0e60ca109129e04a110952762e', 1793555009120::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'owned_marks') = 1 AS owned_marks_table,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.owned_marks'::regclass AND conname IN ('owned_marks_user_id_rawg_id_pk', 'owned_marks_title_check', 'owned_marks_covered_completed', 'owned_marks_user_id_allowed_users_id_fk', 'owned_marks_user_game_fk')) = 5 AS owned_marks_constraints,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'owned_marks_user_covered_idx') = 1 AS owned_marks_index,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793555009120) = 1 AS journal_entry;
