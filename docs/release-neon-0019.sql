-- Миграция 0019 для Neon SQL Editor (без терминала). Фаза 24, контракт 27: журнал событий токена PSN и kind='npsso' в login_attempts.
-- Идемпотентно: можно запускать повторно. Что делает: создаёт таблицу psn_token_events (журнал pasted/refreshed/expired/from_env),
-- пересоздаёт CHECK login_attempts_kind_check с третьим значением 'npsso'. Данные не удаляются и не меняются (expand).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код с лимитом kind='npsso' на старой CHECK упадёт; журнал и статус без таблицы работают мягко).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0019_psn_token_events
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'login_attempts' AND column_name = 'kind') THEN
		RAISE EXCEPTION '0019: сначала применить release-neon-0013.sql ... 0018.sql (нет login_attempts.kind)';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS "psn_token_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "psn_token_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer,
	"event" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psn_token_events_event_check" CHECK ("psn_token_events"."event" in ('pasted','refreshed','expired','from_env'))
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.psn_token_events'::regclass AND conname = 'psn_token_events_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "psn_token_events" ADD CONSTRAINT "psn_token_events_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "psn_token_events_created_idx" ON "psn_token_events" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);

-- login_attempts_kind_check: пересоздаётся только если в нём ещё нет 'npsso'
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.login_attempts'::regclass AND conname = 'login_attempts_kind_check' AND pg_get_constraintdef(oid) LIKE '%npsso%') THEN
		ALTER TABLE "login_attempts" DROP CONSTRAINT IF EXISTS "login_attempts_kind_check";
		ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_kind_check" CHECK ("login_attempts"."kind" in ('password','google','npsso'));
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
	('8f0bc8fd2bc6f695b2b2a5a89292f5607dcd30ef60fabff44cda3deb8d3eae6f', 1793523761942::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'psn_token_events') = 1 AS events_table,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.psn_token_events'::regclass AND conname IN ('psn_token_events_event_check', 'psn_token_events_user_id_allowed_users_id_fk')) = 2 AS events_constraints,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'psn_token_events_created_idx') = 1 AS events_index,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.login_attempts'::regclass AND conname = 'login_attempts_kind_check' AND pg_get_constraintdef(oid) LIKE '%npsso%') = 1 AS kind_check_npsso,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793523761942) = 1 AS journal_entry;
