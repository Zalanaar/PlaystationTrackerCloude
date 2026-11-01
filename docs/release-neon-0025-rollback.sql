-- ОТКАТ миграции 0025 для Neon SQL Editor: возвращает allowed_users к состоянию после 0024. Идемпотентно.
-- Останавливается без изменений, если в БД есть дополнительные профили (primary_user_id IS NOT NULL) или архивные строки:
-- сначала удалите/перенесите их (старая схема не знает про профили, а unique(email) на всех строках их запретит).
-- Что делает: возвращает allowed_users_email_key и прежний CHECK статусов, убирает новые индексы, CHECK и колонки primary_user_id, archived_at,
-- удаляет запись 0025 из журнала drizzle. Затем задеплоить предыдущую версию кода (она работает и на схеме 0025, и на 0024).
-- Данные игр, трофеев и пользователей не меняются.

DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name = 'primary_user_id') THEN
		IF EXISTS (SELECT 1 FROM allowed_users WHERE primary_user_id IS NOT NULL OR status = 'archived') THEN
			RAISE EXCEPTION '0025 rollback: есть дополнительные или архивные профили; сначала удалите их (DELETE FROM allowed_users WHERE primary_user_id IS NOT NULL), изменений не внесено';
		END IF;
	END IF;
END $$;

ALTER TABLE "allowed_users" DROP CONSTRAINT IF EXISTS "allowed_users_profile_check";
ALTER TABLE "allowed_users" DROP CONSTRAINT IF EXISTS "allowed_users_status_check";
ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_status_check" CHECK ("allowed_users"."status" in ('invited','active','blocked'));
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_email_key" ON "allowed_users" USING btree ("email");
DROP INDEX IF EXISTS "allowed_users_email_primary_key";
DROP INDEX IF EXISTS "allowed_users_psn_account_key";
DROP INDEX IF EXISTS "allowed_users_psn_online_key";
DROP INDEX IF EXISTS "allowed_users_primary_idx";
ALTER TABLE "allowed_users" DROP CONSTRAINT IF EXISTS "allowed_users_primary_user_id_allowed_users_id_fk";
ALTER TABLE "allowed_users" DROP COLUMN IF EXISTS "primary_user_id";
ALTER TABLE "allowed_users" DROP COLUMN IF EXISTS "archived_at";

DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793560049496;

SELECT
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'allowed_users' AND column_name IN ('primary_user_id', 'archived_at')) = 0 AS columns_removed,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'allowed_users_email_key') = 1 AS old_email_index_back,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793560049496) = 0 AS journal_entry_removed;
