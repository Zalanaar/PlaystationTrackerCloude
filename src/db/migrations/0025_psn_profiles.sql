ALTER TABLE "allowed_users" DROP CONSTRAINT "allowed_users_status_check";--> statement-breakpoint
ALTER TABLE "allowed_users" ADD COLUMN "primary_user_id" integer;--> statement-breakpoint
ALTER TABLE "allowed_users" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_primary_user_id_allowed_users_id_fk" FOREIGN KEY ("primary_user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_users_email_primary_key" ON "allowed_users" USING btree ("email") WHERE "allowed_users"."primary_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_users_psn_account_key" ON "allowed_users" USING btree ("psn_account_id") WHERE "allowed_users"."psn_account_id" is not null and "allowed_users"."status" <> 'archived';--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_users_psn_online_key" ON "allowed_users" USING btree (lower("psn_online_id")) WHERE "allowed_users"."psn_online_id" is not null and "allowed_users"."status" <> 'archived';--> statement-breakpoint
CREATE INDEX "allowed_users_primary_idx" ON "allowed_users" USING btree ("primary_user_id") WHERE "allowed_users"."primary_user_id" is not null;--> statement-breakpoint
DROP INDEX "allowed_users_email_key";--> statement-breakpoint
ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_profile_check" CHECK (("allowed_users"."primary_user_id" is null or ("allowed_users"."primary_user_id" <> "allowed_users"."id" and "allowed_users"."role" = 'member' and "allowed_users"."google_sub" is null)) and (("allowed_users"."status" = 'archived') = ("allowed_users"."archived_at" is not null)) and ("allowed_users"."status" <> 'archived' or "allowed_users"."primary_user_id" is not null));--> statement-breakpoint
ALTER TABLE "allowed_users" ADD CONSTRAINT "allowed_users_status_check" CHECK ("allowed_users"."status" in ('invited','active','blocked','archived'));