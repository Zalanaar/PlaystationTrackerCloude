-- Миграции 0004–0005 для Neon SQL Editor (без терминала). Этап 2, контракт 15.
-- Идемпотентно: можно запускать повторно, уже применённое пропускается. Только добавляет, данные не теряются.
-- Применять ПОСЛЕ docs/release-neon-0001-0003.sql и ДО деплоя кода Этапа 2.
-- Последний блок записывает миграции в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить их снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0004_month_exclusions
CREATE TABLE IF NOT EXISTS "game_month_exclusions" (
	"game_id" integer NOT NULL,
	"month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_month_exclusions_game_id_month_pk" PRIMARY KEY("game_id","month"),
	CONSTRAINT "game_month_exclusions_month_check" CHECK ("game_month_exclusions"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'game_month_exclusions_game_id_games_id_fk') THEN
		ALTER TABLE "game_month_exclusions" ADD CONSTRAINT "game_month_exclusions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

-- 0005_tint_trophy_groups_notify
CREATE TABLE IF NOT EXISTS "notify_log" (
	"kind" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"sent_on" date NOT NULL
);
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "tint" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "tint_checked_at" timestamp with time zone;
ALTER TABLE "trophies" ADD COLUMN IF NOT EXISTS "group_id" text;
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_tint_check') THEN
		ALTER TABLE "games" ADD CONSTRAINT "games_tint_check" CHECK ("games"."tint" is null or "games"."tint" ~ '^#[0-9a-f]{6}$');
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
	('ad5a47bf96903b5e14667e5036af3b9897fd65aa37d0476b538dccdd47ac4ea7', 1793188842489::bigint),
	('b07399ee8c7d34a454100cdc482e7009dc8c0163e10419f626c30632db30be98', 1793188850139::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 6 (или 5, если 0000 ставили не через drizzle), все остальные колонки true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	to_regclass('public.game_month_exclusions') IS NOT NULL AS game_month_exclusions,
	to_regclass('public.notify_log') IS NOT NULL AS notify_log,
	EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'tint') AS games_tint,
	EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'tint_checked_at') AS games_tint_checked_at,
	EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trophies' AND column_name = 'group_id') AS trophies_group_id;
