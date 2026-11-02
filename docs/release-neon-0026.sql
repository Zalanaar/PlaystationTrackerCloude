-- Миграция 0026 для Neon SQL Editor (без терминала). Фаза 43, контракт 43.1: таблица manual_games (игры вне библиотеки PSN, «не куплено» в Бэклоге).
-- Идемпотентно: можно запускать повторно. Что делает (только добавляет таблицу, expand): manual_games с CHECK по названию, виду (ps_backlog | other_platform),
-- «не куплено» только у ps_backlog, связи с игрой библиотеки; составные FK (user_id, linked_game_id) и (user_id, suggested_game_id) на games(user_id, id) ON DELETE CASCADE,
-- FK на allowed_users ON DELETE CASCADE, уникальность (user_id, rawg_id, kind), два индекса. Данные других таблиц не меняются.
-- Порядок: ветка Neon before-0026 (по желанию) -> release-neon-0026-check.sql («до») -> этот скрипт -> check («после») -> деплой кода.
-- Миграция строго ДО кода: новый код на старой схеме отвечает на роуты manual-games 503, синк пропускает шаг с предупреждением, остальное работает.
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0026_manual_games
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'primary_user_id') THEN
		RAISE EXCEPTION '0026: сначала применить release-neon-0025.sql (нет колонки allowed_users.primary_user_id)';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS "manual_games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"rawg_id" text NOT NULL,
	"title" text NOT NULL,
	"cover_url" text,
	"release_date" date,
	"kind" text NOT NULL,
	"not_purchased" boolean DEFAULT false NOT NULL,
	"linked_game_id" integer,
	"suggested_game_id" integer,
	"rejected_game_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"platform_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_games_title_check" CHECK (char_length("manual_games"."title") between 1 and 200),
	CONSTRAINT "manual_games_kind_check" CHECK ("manual_games"."kind" in ('ps_backlog','other_platform')),
	CONSTRAINT "manual_games_not_purchased_check" CHECK ("manual_games"."kind" = 'ps_backlog' or "manual_games"."not_purchased" = false),
	CONSTRAINT "manual_games_linked_check" CHECK ("manual_games"."linked_game_id" is null or ("manual_games"."not_purchased" = false and "manual_games"."suggested_game_id" is null)),
	CONSTRAINT "manual_games_platform_label_check" CHECK ("manual_games"."platform_label" is null or char_length("manual_games"."platform_label") between 1 and 60)
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.manual_games'::regclass AND conname = 'manual_games_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "manual_games" ADD CONSTRAINT "manual_games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.manual_games'::regclass AND conname = 'manual_games_user_linked_fk') THEN
		ALTER TABLE "manual_games" ADD CONSTRAINT "manual_games_user_linked_fk" FOREIGN KEY ("user_id","linked_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.manual_games'::regclass AND conname = 'manual_games_user_suggested_fk') THEN
		ALTER TABLE "manual_games" ADD CONSTRAINT "manual_games_user_suggested_fk" FOREIGN KEY ("user_id","suggested_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "manual_games_user_rawg_kind_key" ON "manual_games" USING btree ("user_id","rawg_id","kind");
CREATE INDEX IF NOT EXISTS "manual_games_user_kind_idx" ON "manual_games" USING btree ("user_id","kind");
CREATE INDEX IF NOT EXISTS "manual_games_user_suggested_idx" ON "manual_games" USING btree ("user_id","suggested_game_id") WHERE "manual_games"."suggested_game_id" is not null;

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
	('1e63890914bbaef021e4bb9a9388dc353d584bd3b040031f2e96cd282df2fb37', 1793608033949::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manual_games') = 1 AS manual_games_table,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.manual_games'::regclass AND conname IN ('manual_games_title_check', 'manual_games_kind_check', 'manual_games_not_purchased_check', 'manual_games_linked_check', 'manual_games_platform_label_check', 'manual_games_user_id_allowed_users_id_fk', 'manual_games_user_linked_fk', 'manual_games_user_suggested_fk')) = 8 AS manual_games_constraints,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('manual_games_user_rawg_kind_key', 'manual_games_user_kind_idx', 'manual_games_user_suggested_idx')) = 3 AS manual_games_indexes,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793608033949) = 1 AS journal_entry;
