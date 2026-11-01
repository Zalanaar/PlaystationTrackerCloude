CREATE TABLE "digest_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_week" text,
	"last_advice_game_id" integer
);
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_chats_chat_id_check" CHECK ("telegram_chats"."chat_id" ~ '^-?[0-9]{1,20}$')
);
--> statement-breakpoint
CREATE TABLE "telegram_link_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telegram_link_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chat_id" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digest_state" ADD CONSTRAINT "digest_state_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chats_chat_id_key" ON "telegram_chats" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "telegram_link_attempts_chat_idx" ON "telegram_link_attempts" USING btree ("chat_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_key" ON "telegram_link_codes" USING btree ("code_hash");