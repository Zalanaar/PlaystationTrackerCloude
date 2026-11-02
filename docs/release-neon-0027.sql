-- Миграция 0027 для Neon SQL Editor (без терминала). Фаза 45: отзыв сессий на сервере.
-- Идемпотентно: можно запускать повторно. Что делает (только добавляет, expand): колонка allowed_users.session_epoch integer NOT NULL DEFAULT 0
-- («Выйти на всех устройствах» увеличивает её) и таблица revoked_sessions (sid, user_id, expires_at, revoked_at) с FK на allowed_users ON DELETE CASCADE
-- и индексом по expires_at («Выйти» записывает туда текущую сессию до её истечения). Существующие данные не меняются, все текущие входы остаются действующими.
-- Порядок: release-neon-0027-check.sql («до») -> этот скрипт -> check («после») -> деплой кода.
-- Миграция строго ДО кода: новый код на старой схеме не прочитает allowed_users (нет session_epoch) и все роуты ответят 503. Старый код на новой схеме работает как раньше.
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0027_session_revocation
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'manual_games') THEN
		RAISE EXCEPTION '0027: сначала применить release-neon-0026.sql (нет таблицы manual_games)';
	END IF;
END $$;

ALTER TABLE "allowed_users" ADD COLUMN IF NOT EXISTS "session_epoch" integer DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "revoked_sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.revoked_sessions'::regclass AND conname = 'revoked_sessions_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "revoked_sessions" ADD CONSTRAINT "revoked_sessions_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "revoked_sessions_expires_idx" ON "revoked_sessions" USING btree ("expires_at");

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
	('20734e1e9c1473c54cdb9b2b6277ad68fe9aa8feed78a3f72e636ea7c95c28cb', 1793647361240::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'session_epoch' AND is_nullable = 'NO') = 1 AS session_epoch_column,
	(SELECT count(*) FROM allowed_users WHERE session_epoch <> 0) = 0 AS epochs_zero,
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'revoked_sessions') = 1 AS revoked_sessions_table,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.revoked_sessions'::regclass AND conname IN ('revoked_sessions_pkey', 'revoked_sessions_user_id_allowed_users_id_fk')) = 2 AS revoked_sessions_constraints,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'revoked_sessions_expires_idx') = 1 AS revoked_sessions_index,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793647361240) = 1 AS journal_entry;
