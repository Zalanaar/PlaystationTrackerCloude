-- Миграция 0013 для Neon SQL Editor (без терминала). Фаза 20.2, контракт 22.2 и 22.7.
-- Идемпотентно: можно запускать повторно. Только добавляет (таблица allowed_users, колонка login_attempts.kind), данные игр не затрагиваются.
-- Применять ПОСЛЕ docs/release-neon-0012.sql, затем docs/release-neon-0013-owner.sql, и только потом деплой:
-- без таблицы вход (пароль и Google), /api/auth/me и /api/access/* не работают.
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0013_allowed_users
CREATE TABLE IF NOT EXISTS "allowed_users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "allowed_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"google_sub" text,
	"display_name" text,
	"psn_online_id" text,
	"psn_account_id" text,
	"psn_access_mode" text DEFAULT 'public' NOT NULL,
	"psn_access_status" text DEFAULT 'unchecked' NOT NULL,
	"psn_access_checked_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"invited_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_users_role_check" CHECK ("allowed_users"."role" in ('owner','member')),
	CONSTRAINT "allowed_users_status_check" CHECK ("allowed_users"."status" in ('invited','active','blocked')),
	CONSTRAINT "allowed_users_psn_access_mode_check" CHECK ("allowed_users"."psn_access_mode" in ('public','friend')),
	CONSTRAINT "allowed_users_psn_access_status_check" CHECK ("allowed_users"."psn_access_status" in ('unchecked','ok','private','not_found','friend_required','unavailable')),
	CONSTRAINT "allowed_users_email_check" CHECK ("allowed_users"."email" ~ '^[^@\s]+@[^@\s]+$' and char_length("allowed_users"."email") <= 254),
	CONSTRAINT "allowed_users_owner_not_blocked_check" CHECK ("allowed_users"."role" <> 'owner' or "allowed_users"."status" <> 'blocked')
);

ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'password' NOT NULL;
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowed_users_invited_by_allowed_users_id_fk') THEN
		ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_invited_by_allowed_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."allowed_users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'login_attempts_kind_check') THEN
		ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_kind_check" CHECK ("login_attempts"."kind" in ('password','google'));
	END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_email_key" ON "allowed_users" USING btree ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_google_sub_key" ON "allowed_users" USING btree ("google_sub") WHERE "allowed_users"."google_sub" is not null;
CREATE UNIQUE INDEX IF NOT EXISTS "allowed_users_single_owner_key" ON "allowed_users" USING btree ((true)) WHERE "allowed_users"."role" = 'owner';

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
	('01bbfd563222c334154232e07fed0b7635dbd3ea1effe57d0341fb2f38e2b9a8', 1793399238185::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'allowed_users') = 1 AS users_table,
	(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'login_attempts' AND column_name = 'kind') = 1 AS kind_column,
	(SELECT count(*) FROM pg_indexes WHERE tablename = 'allowed_users' AND indexname IN ('allowed_users_email_key', 'allowed_users_google_sub_key', 'allowed_users_single_owner_key')) = 3 AS indexes;
