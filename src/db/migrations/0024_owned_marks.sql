CREATE TABLE "owned_marks" (
	"user_id" integer NOT NULL,
	"rawg_id" text NOT NULL,
	"title" text NOT NULL,
	"title_key" text NOT NULL,
	"cover_url" text,
	"covered_by_game_id" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owned_marks_user_id_rawg_id_pk" PRIMARY KEY("user_id","rawg_id"),
	CONSTRAINT "owned_marks_title_check" CHECK (char_length("owned_marks"."title") between 1 and 200),
	CONSTRAINT "owned_marks_covered_completed" CHECK ("owned_marks"."covered_by_game_id" is null or "owned_marks"."completed" = false)
);
--> statement-breakpoint
ALTER TABLE "owned_marks" ADD CONSTRAINT "owned_marks_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owned_marks" ADD CONSTRAINT "owned_marks_user_game_fk" FOREIGN KEY ("user_id","covered_by_game_id") REFERENCES "public"."games"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owned_marks_user_covered_idx" ON "owned_marks" USING btree ("user_id","covered_by_game_id") WHERE "owned_marks"."covered_by_game_id" is not null;