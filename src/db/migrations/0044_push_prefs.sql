CREATE TABLE "push_prefs" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"shelved_reminder" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_prefs" ADD CONSTRAINT "push_prefs_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;