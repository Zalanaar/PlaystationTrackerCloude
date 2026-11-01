-- Миграция 0020 для Neon SQL Editor (без терминала). Фаза 27, контракт 28: таблица отказов «не предлагать подсказку статуса».
-- Идемпотентно: можно запускать повторно. Что делает: создаёт таблицу status_hint_dismissals (user_id, game_id, rule) с PK по тройке,
-- CHECK по правилу и внешними ключами на allowed_users и games (ON DELETE CASCADE). Данные других таблиц не меняются (expand).
-- Порядок: сначала этот скрипт, потом деплой кода (новый код на старой схеме отвечает на подсказки 503, остальной сайт работает).
-- Последний блок записывает миграцию в журнал drizzle. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0020_status_hint_dismissals
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'psn_token_events') THEN
		RAISE EXCEPTION '0020: сначала применить release-neon-0013.sql ... 0019.sql (нет psn_token_events)';
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS "status_hint_dismissals" (
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_hint_dismissals_user_id_game_id_rule_pk" PRIMARY KEY("user_id","game_id","rule"),
	CONSTRAINT "status_hint_dismissals_rule_check" CHECK ("status_hint_dismissals"."rule" in ('started','stale','platinum','returned'))
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.status_hint_dismissals'::regclass AND conname = 'status_hint_dismissals_user_id_allowed_users_id_fk') THEN
		ALTER TABLE "status_hint_dismissals" ADD CONSTRAINT "status_hint_dismissals_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.status_hint_dismissals'::regclass AND conname = 'status_hint_dismissals_user_game_fk') THEN
		ALTER TABLE "status_hint_dismissals" ADD CONSTRAINT "status_hint_dismissals_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
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
	('43304bb35995c3e3b9bcea517fbb70cd50d11a1808b61818218b54fa4c928b94', 1793525886268::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: все флаги true.
SELECT
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'status_hint_dismissals') = 1 AS dismissals_table,
	(SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.status_hint_dismissals'::regclass AND conname IN ('status_hint_dismissals_user_id_game_id_rule_pk', 'status_hint_dismissals_rule_check', 'status_hint_dismissals_user_id_allowed_users_id_fk', 'status_hint_dismissals_user_game_fk')) = 4 AS dismissals_constraints,
	(SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = 1793525886268) = 1 AS journal_entry;
