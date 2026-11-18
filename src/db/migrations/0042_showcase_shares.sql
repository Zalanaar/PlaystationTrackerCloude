-- П14.3: публичная витрина — хэш ключа ссылки (аддитивно, новая таблица; по умолчанию витрина закрыта).
CREATE TABLE "showcase_shares" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showcase_shares_token_hash_check" CHECK ("showcase_shares"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "showcase_shares" ADD CONSTRAINT "showcase_shares_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "showcase_shares_token_hash_key" ON "showcase_shares" USING btree ("token_hash");