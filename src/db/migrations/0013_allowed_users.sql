CREATE TABLE "allowed_users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "allowed_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"google_sub" text,
	"display_name" text,
	"psn_online_id" text,
	"psn_account_id" text,
	"psn_access_mode" text DEFAULT 'public' NOT NULL,
	"psn_access_status" text DEFAULT 'unchecked' NOT NULL,
	"psn_access_checked_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"invited_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_users_role_check" CHECK ("allowed_users"."role" in ('owner','member')),
	CONSTRAINT "allowed_users_status_check" CHECK ("allowed_users"."status" in ('invited','active','blocked')),
	CONSTRAINT "allowed_users_psn_access_mode_check" CHECK ("allowed_users"."psn_access_mode" in ('public','friend')),
	CONSTRAINT "allowed_users_psn_access_status_check" CHECK ("allowed_users"."psn_access_status" in ('unchecked','ok','private','not_found','friend_required','unavailable')),
	CONSTRAINT "allowed_users_email_check" CHECK ("allowed_users"."email" ~ '^[^@\s]+@[^@\s]+$' and char_length("allowed_users"."email") <= 254),
	CONSTRAINT "allowed_users_owner_not_blocked_check" CHECK ("allowed_users"."role" <> 'owner' or "allowed_users"."status" <> 'blocked')
);
--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "kind" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_invited_by_allowed_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."allowed_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_users_email_key" ON "allowed_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_users_google_sub_key" ON "allowed_users" USING btree ("google_sub") WHERE "allowed_users"."google_sub" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_users_single_owner_key" ON "allowed_users" USING btree ((true)) WHERE "allowed_users"."role" = 'owner';--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_kind_check" CHECK ("login_attempts"."kind" in ('password','google'));