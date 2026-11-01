-- Миграция 0025 для Neon SQL Editor (без терминала). Фаза 41, контракт 41.1/41.5: несколько профилей PSN у одного входа.
-- Идемпотентно: можно запускать повторно. Что делает (только allowed_users, expand): колонки primary_user_id (FK на себя, ON DELETE CASCADE) и archived_at,
-- статус archived в CHECK, allowed_users_profile_check, частичный unique(email) среди основных профилей (старый allowed_users_email_key удаляется ПОСЛЕ создания нового),
-- частичные unique по psn_account_id и lower(psn_online_id) среди не-архивных, индекс allowed_users_primary_idx.
-- Данные не меняются: все существующие строки автоматически основные (primary_user_id = NULL). Игры, трофеи, снимки, статусы не затрагиваются.
-- Порядок: ветка Neon before-0025 -> release-neon-0025-check.sql («до») -> этот скрипт -> check («после») -> деплой кода.
-- Миграция строго ДО кода (новый код на старой схеме падает). Старый код на новой схеме работает.
-- Перед изменениями скрипт останавливается (RAISE EXCEPTION), если owner не id = 1 либо есть дубли psn_account_id / lower(psn_online_id).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0025_psn_profiles
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'owned_marks') THEN
		RAISE EXCEPTION '0025: сначала применить release-neon-0024.sql (нет таблицы owned_marks)';
	END IF;
	IF EXISTS (SELECT 1 FROM allowed_users WHERE role = 'owner' AND id <> 1) THEN
		RAISE EXCEPTION '0025: owner должен иметь id = 1; остановитесь и ничего не деплойте';
	END IF;
	IF EXISTS (SELECT 1 FROM allowed_users WHERE psn_account_id IS NOT NULL GROUP BY psn_account_id HAVING count(*) > 1) THEN
		RAISE EXCEPTION '0025: дубли psn_account_id в allowed_users; разберите вручную (см. check-запрос), изменений не внесено';
	END IF;
	IF EXISTS (SELECT 1 FROM allowed_users WHERE psn_online_id IS NOT NULL GROUP BY lower(psn_online_id) HAVING count(*) > 1) THEN
		RAISE EXCEPTION '0025: дубли lower(psn_online_id) в allowed_users; разберите вручную (см. check-запрос), изменений не внесено';
	END IF;
END $$;

ALTER TABLE "allowed_users" ADD COLUMN IF NOT EXISTS "primary_user_id" integer;
ALTER TABLE "allowed_users" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.allowed_users'::regclass AND conname = 'allowed_users_primary_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_primary_user_id_allowed_users_id_fk" FOREIGN KEY ("primary_user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_email_primary_key" ON "allowed_users" USING btree ("email") WHERE "allowed_users"."primary_user_id" is null;
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_psn_account_key" ON "allowed_users" USING btree ("psn_account_id") WHERE "allowed_users"."psn_account_id" is not null and "allowed_users"."status" <> 'archived';
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_psn_online_key" ON "allowed_users" USING btree (lower("psn_online_id")) WHERE "allowed_users"."psn_online_id" is not null and "allowed_users"."status" <> 'archived';
CREATE INDEX IF NOT EXISTS "allowed_users_primary_idx" ON "allowed_users" USING btree ("primary_user_id") WHERE "allowed_users"."primary_user_id" is not null;
DROP INDEX IF EXISTS "allowed_users_email_key";

DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.allowed_users'::regclass AND conname = 'allowed_users_status_check' AND pg_get_constraintdef(oid) NOT LIKE '%archived%') THEN
		ALTER TABLE "allowed_users" DROP CONSTRAINT "allowed_users_status_check";
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.allowed_users'::regclass AND conname = 'allowed_users_status_check') THEN
		ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_status_check" CHECK ("allowed_users"."status" in ('invited','active','blocked','archived'));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.allowed_users'::regclass AND conname = 'allowed_users_profile_check') THEN
		ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_profile_check" CHECK (("allowed_users"."primary_user_id" is null or ("allowed_users"."primary_user_id" <> "allowed_users"."id" and "allowed_users"."role" = 'member' and "allowed_users"."google_sub" is null)) and (("allowed_users"."status" = 'archived') = ("allowed_users"."archived_at" is not null)) and ("allowed_users"."status" <> 'archived' or "allowed_users"."primary_user_id" is not null));
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
	('aab80432de918fce53ae1d53308638eb7bc5ea3d36c72c014fccf7512cef2591', 1793560049496::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name IN ('primary_user_id', 'archived_at')) = 2 AS columns_ok,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('allowed_users_email_primary_key', 'allowed_users_psn_account_key', 'allowed_users_psn_online_key', 'allowed_users_primary_idx')) = 4 AS indexes_ok,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'allowed_users_email_key') = 0 AS old_email_index_dropped,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.allowed_users'::regclass AND conname IN ('allowed_users_primary_user_id_allowed_users_id_fk', 'allowed_users_status_check', 'allowed_users_profile_check')) = 3 AS constraints_ok,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793560049496) = 1 AS journal_entry;
