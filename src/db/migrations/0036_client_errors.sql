CREATE TABLE "client_errors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_errors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"path" text,
	"source" text,
	"stack" text,
	"ua" text,
	CONSTRAINT "client_errors_kind_check" CHECK ("client_errors"."kind" in ('error','rejection'))
);
--> statement-breakpoint
ALTER TABLE "client_errors" ADD CONSTRAINT "client_errors_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_errors_user_created_idx" ON "client_errors" USING btree ("user_id","created_at" DESC NULLS LAST);