-- Миграции 0001–0003 для Neon SQL Editor (без терминала).
-- Идемпотентно: можно запускать повторно, уже применённое пропускается.
-- Последний блок записывает миграции в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить их снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0001_game_status_service
ALTER TYPE "public"."game_status_value" ADD VALUE IF NOT EXISTS 'service';

-- 0002_status_backups_hidden
CREATE TABLE IF NOT EXISTS "status_backups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "status_backups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"payload" jsonb NOT NULL
);
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;

-- 0003_profile_banner
CREATE TABLE IF NOT EXISTS "psn_profile" (
	"id" smallint PRIMARY KEY NOT NULL,
	"online_id" text NOT NULL,
	"avatar_url" text,
	"trophy_level" smallint,
	"trophy_progress" smallint,
	"trophy_tier" smallint,
	"earned_platinum" integer,
	"earned_gold" integer,
	"earned_silver" integer,
	"earned_bronze" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psn_profile_singleton_check" CHECK ("psn_profile"."id" = 1)
);
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "banner_url" text;

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
	('197b99560fec9b977b2ffab6bacf063f25609786dff5db410bb328e69f1f1517', 1793134345881::bigint),
	('976e15cd46fc4396bc2c985bc69d9a7e7cdd04cbb8b84709293b614c40e8be14', 1793174157236::bigint),
	('ccfe3a7d26312c9982ef5f8db1a15edf0f400f3f498029ca417ecb82d2be7f09', 1793179023631::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 4 (или 3, если 0000 ставили не через drizzle), в statuses есть service, обе таблицы true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT string_agg(enumlabel, ',') FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'game_status_value') AS statuses,
	to_regclass('public.status_backups') IS NOT NULL AS status_backups,
	to_regclass('public.psn_profile') IS NOT NULL AS psn_profile;
