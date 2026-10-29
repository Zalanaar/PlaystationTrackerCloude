CREATE TABLE "planned_games" (
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
--> statement-breakpoint
CREATE TABLE "roadmap_order" (
	"game_id" integer PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_order_position_check" CHECK ("roadmap_order"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "roadmap_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"hours_per_week" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roadmap_settings_singleton_check" CHECK ("roadmap_settings"."id" = 1),
	CONSTRAINT "roadmap_settings_year_check" CHECK ("roadmap_settings"."year" >= 2000 and "roadmap_settings"."year" <= 2100),
	CONSTRAINT "roadmap_settings_hours_check" CHECK ("roadmap_settings"."hours_per_week" > 0 and "roadmap_settings"."hours_per_week" <= 168)
);
--> statement-breakpoint
ALTER TABLE "roadmap_order" ADD CONSTRAINT "roadmap_order_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planned_games_external_key" ON "planned_games" USING btree ("external_source","external_id") WHERE "planned_games"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "planned_games_status_idx" ON "planned_games" USING btree ("status");--> statement-breakpoint
CREATE INDEX "roadmap_order_position_idx" ON "roadmap_order" USING btree ("position");