-- Миграция 0008 для Neon SQL Editor (без терминала). Фаза 12, контракт 17.
-- Идемпотентно: можно запускать повторно. Только создаёт три новые таблицы, существующие данные не затрагиваются.
-- Применять ПОСЛЕ docs/release-neon-0007.sql и ДО деплоя кода Фазы 12.
-- Последний блок записывает миграцию в журнал drizzle, чтобы `npm run db:migrate`
-- позже не пытался применить её снова. Хеш = sha256 файла миграции, created_at = when из _journal.json.

-- 0008_roadmap_planning
CREATE TABLE IF NOT EXISTS "planned_games" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "planned_games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"release_date" date,
	"cover_url" text,
	"want_at_release" boolean DEFAULT false NOT NULL,
	"hours_manual" double precision,
	"external_source" text,
	"external_id" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_games_want_release_check" CHECK (not "planned_games"."want_at_release" or "planned_games"."release_date" is not null),
	CONSTRAINT "planned_games_hours_check" CHECK ("planned_games"."hours_manual" is null or "planned_games"."hours_manual" > 0),
	CONSTRAINT "planned_games_source_check" CHECK ("planned_games"."external_source" is null or "planned_games"."external_source" = 'rawg'),
	CONSTRAINT "planned_games_external_pair_check" CHECK (("planned_games"."external_source" is null) = ("planned_games"."external_id" is null)),
	CONSTRAINT "planned_games_status_check" CHECK ("planned_games"."status" in ('planned', 'done', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS "roadmap_order" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_order_position_check" CHECK ("roadmap_order"."position" >= 0)
);

CREATE TABLE IF NOT EXISTS "roadmap_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"hours_per_week" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_settings_singleton_check" CHECK ("roadmap_settings"."id" = 1),
	CONSTRAINT "roadmap_settings_year_check" CHECK ("roadmap_settings"."year" >= 2000 and "roadmap_settings"."year" <= 2100),
	CONSTRAINT "roadmap_settings_hours_check" CHECK ("roadmap_settings"."hours_per_week" > 0 and "roadmap_settings"."hours_per_week" <= 168)
);

DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roadmap_order_game_id_games_id_fk') THEN
		ALTER TABLE "roadmap_order" ADD CONSTRAINT "roadmap_order_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "planned_games_external_key" ON "planned_games" USING btree ("external_source","external_id") WHERE "planned_games"."external_id" is not null;
CREATE INDEX IF NOT EXISTS "planned_games_status_idx" ON "planned_games" USING btree ("status");
CREATE INDEX IF NOT EXISTS "roadmap_order_position_idx" ON "roadmap_order" USING btree ("position");

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
	('9af44501414c10ff840570061e2bd8d89be6ea511dd53c0eb7ccd31370ebead0', 1793257418269::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.created_at = v.created_at);

-- Проверка: migrations = 9 (или 8, если 0000 ставили не через drizzle), все три флага true.
SELECT
	(SELECT count(*) FROM drizzle.__drizzle_migrations) AS migrations,
	(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('planned_games','roadmap_order','roadmap_settings')) = 3 AS roadmap_tables,
	(SELECT count(*) FROM pg_constraint WHERE conname IN ('planned_games_want_release_check','planned_games_hours_check','planned_games_source_check','planned_games_external_pair_check','planned_games_status_check','roadmap_order_position_check','roadmap_order_game_id_games_id_fk','roadmap_settings_singleton_check','roadmap_settings_year_check','roadmap_settings_hours_check')) = 10 AS roadmap_constraints,
	(SELECT count(*) FROM pg_indexes WHERE indexname IN ('planned_games_external_key','planned_games_status_idx','roadmap_order_position_idx')) = 3 AS roadmap_indexes;
