-- Миграция 0021 для Neon SQL Editor (без терминала). Фаза 29, контракт F29: сводка в Telegram.
-- Идемпотентно: можно запускать повторно. Что делает: создаёт четыре новые таблицы telegram_chats, telegram_link_codes,
-- telegram_link_attempts, digest_state (внешние ключи на allowed_users ON DELETE CASCADE). Данные других таблиц не меняются (expand).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код на старой схеме: привязка отвечает 503, сводка владельцу идёт без своего состояния, сайт работает).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0021_telegram_digest
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'status_hint_dismissals') THEN
		RAISE EXCEPTION '0021: сначала применить release-neon-0020.sql (нет status_hint_dismissals)';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS "digest_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_week" text,
	"last_advice_game_id" integer
);

CREATE TABLE IF NOT EXISTS "telegram_chats" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_chats_chat_id_check" CHECK ("telegram_chats"."chat_id" ~ '^-?[0-9]{1,20}$')
);

CREATE TABLE IF NOT EXISTS "telegram_link_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_link_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chat_id" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "telegram_link_codes" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.digest_state'::regclass AND conname = 'digest_state_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "digest_state" ADD CONSTRAINT "digest_state_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.telegram_chats'::regclass AND conname = 'telegram_chats_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.telegram_link_codes'::regclass AND conname = 'telegram_link_codes_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chats_chat_id_key" ON "telegram_chats" USING btree ("chat_id");
CREATE INDEX IF NOT EXISTS "telegram_link_attempts_chat_idx" ON "telegram_link_attempts" USING btree ("chat_id","attempted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_link_codes_code_hash_key" ON "telegram_link_codes" USING btree ("code_hash");

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
	('2f6ea3b990c1ff2d432c8618425f07d31d82faad711f47c79ce2c79a19ed2f7c', 1793537134196::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('telegram_chats', 'telegram_link_codes', 'telegram_link_attempts', 'digest_state')) = 4 AS tables,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('digest_state_user_id_allowed_users_id_fk', 'telegram_chats_user_id_allowed_users_id_fk', 'telegram_link_codes_user_id_allowed_users_id_fk', 'telegram_chats_chat_id_check')) = 4 AS constraints,
	(SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('telegram_chats_chat_id_key', 'telegram_link_attempts_chat_idx', 'telegram_link_codes_code_hash_key')) = 3 AS indexes,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793537134196) = 1 AS journal_entry;
