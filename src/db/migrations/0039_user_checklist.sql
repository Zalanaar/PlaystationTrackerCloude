-- П13.4: «Первая неделя» скрыта пользователем (аддитивно, новая таблица).
CREATE TABLE "user_checklist" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_checklist" ADD CONSTRAINT "user_checklist_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;