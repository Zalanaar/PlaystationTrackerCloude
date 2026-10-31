DO $$ BEGIN
	-- 0014 подставляет user_id = 1 (owner, гарантирован db:bootstrap-owner). Есть данные, а owner с id = 1 нет: останавливаемся до любых изменений.
	IF NOT EXISTS (SELECT 1 FROM "allowed_users" WHERE "id" = 1 AND "role" = 'owner')
		AND (SELECT count(*) FROM "games") + (SELECT count(*) FROM "sync_runs") + (SELECT count(*) FROM "psn_profile") + (SELECT count(*) FROM "roadmap_settings") + (SELECT count(*) FROM "planned_games") + (SELECT count(*) FROM "status_backups") + (SELECT count(*) FROM "recommend_llm_usage") + (SELECT count(*) FROM "recommend_discover_cache") + (SELECT count(*) FROM "recommend_external_dislikes") > 0 THEN
		RAISE EXCEPTION '0014: owner (allowed_users.id = 1, role = owner) не найден; сначала docs/release-neon-0013-owner.sql';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "psn_profile" ALTER COLUMN "id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "roadmap_settings" ALTER COLUMN "id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "game_month_exclusions" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_status" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "planned_games" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "playtime_snapshots" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "psn_profile" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_discover_cache" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_dislikes" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_external_dislikes" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommend_reasons" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_excluded" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_order" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roadmap_settings" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "status_backups" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trophies" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trophy_sets" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "game_status_user_status_idx" ON "game_status" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "game_trophy_sets_user_game_idx" ON "game_trophy_sets" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_user_title_id_key" ON "games" USING btree ("user_id","title_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_user_id_id_key" ON "games" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "games_user_concept_id_idx" ON "games" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "games_user_last_played_at_idx" ON "games" USING btree ("user_id","last_played_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "planned_games_user_external_key" ON "planned_games" USING btree ("user_id","external_source","external_id") WHERE "planned_games"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "planned_games_user_status_idx" ON "planned_games" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "playtime_snapshots_user_game_date_key" ON "playtime_snapshots" USING btree ("user_id","game_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "playtime_snapshots_user_date_idx" ON "playtime_snapshots" USING btree ("user_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "psn_profile_user_key" ON "psn_profile" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommend_discover_cache_user_day_key" ON "recommend_discover_cache" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "recommend_external_dislikes_user_key" ON "recommend_external_dislikes" USING btree ("user_id","external_source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommend_llm_usage_user_day_key" ON "recommend_llm_usage" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "roadmap_order_user_position_idx" ON "roadmap_order" USING btree ("user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "roadmap_settings_user_key" ON "roadmap_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "status_backups_user_created_idx" ON "status_backups" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_runs_user_started_at_idx" ON "sync_runs" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "trophies_user_set_trophy_key" ON "trophies" USING btree ("user_id","trophy_set_id","trophy_id");--> statement-breakpoint
CREATE INDEX "trophies_user_earned_at_idx" ON "trophies" USING btree ("user_id","earned_at") WHERE "trophies"."earned_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trophy_sets_user_np_key" ON "trophy_sets" USING btree ("user_id","np_communication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trophy_sets_user_id_id_key" ON "trophy_sets" USING btree ("user_id","id");--> statement-breakpoint
ALTER TABLE "game_month_exclusions" ADD CONSTRAINT "game_month_exclusions_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_month_exclusions" ADD CONSTRAINT "game_month_exclusions_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_status" ADD CONSTRAINT "game_status_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_status" ADD CONSTRAINT "game_status_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_trophy_sets" ADD CONSTRAINT "game_trophy_sets_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_games" ADD CONSTRAINT "planned_games_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playtime_snapshots" ADD CONSTRAINT "playtime_snapshots_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playtime_snapshots" ADD CONSTRAINT "playtime_snapshots_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psn_profile" ADD CONSTRAINT "psn_profile_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_discover_cache" ADD CONSTRAINT "recommend_discover_cache_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_dislikes" ADD CONSTRAINT "recommend_dislikes_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_dislikes" ADD CONSTRAINT "recommend_dislikes_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_external_dislikes" ADD CONSTRAINT "recommend_external_dislikes_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_llm_usage" ADD CONSTRAINT "recommend_llm_usage_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommend_reasons" ADD CONSTRAINT "recommend_reasons_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_excluded" ADD CONSTRAINT "roadmap_excluded_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_excluded" ADD CONSTRAINT "roadmap_excluded_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_order" ADD CONSTRAINT "roadmap_order_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_order" ADD CONSTRAINT "roadmap_order_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_settings" ADD CONSTRAINT "roadmap_settings_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_backups" ADD CONSTRAINT "status_backups_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophies" ADD CONSTRAINT "trophies_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophies" ADD CONSTRAINT "trophies_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_sets" ADD CONSTRAINT "trophy_sets_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
