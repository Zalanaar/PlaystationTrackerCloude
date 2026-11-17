-- П13.2: только новые таблицы (уникальный индекс game_tags(user_id,id) до составного внешнего ключа)
CREATE TABLE "game_tag_links" (
	"user_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_tag_links_tag_id_game_id_pk" PRIMARY KEY("tag_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "game_tags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "game_tags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_tags_name_check" CHECK (char_length("game_tags"."name") between 1 and 32)
);
--> statement-breakpoint
CREATE INDEX "game_tag_links_user_game_idx" ON "game_tag_links" USING btree ("user_id","game_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "game_tags_user_id_id_key" ON "game_tags" USING btree ("user_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "game_tags_user_name_key" ON "game_tags" USING btree ("user_id",lower("name"));
--> statement-breakpoint
ALTER TABLE "game_tag_links" ADD CONSTRAINT "game_tag_links_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_tag_links" ADD CONSTRAINT "game_tag_links_user_tag_fk" FOREIGN KEY ("user_id","tag_id") REFERENCES "public"."game_tags"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_tag_links" ADD CONSTRAINT "game_tag_links_user_game_fk" FOREIGN KEY ("user_id","game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;
