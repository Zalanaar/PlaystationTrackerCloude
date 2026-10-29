CREATE TABLE "recommend_discover_cache" (
	"day" date PRIMARY KEY NOT NULL,
	"profile_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"refreshes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_discover_cache_refreshes_check" CHECK ("recommend_discover_cache"."refreshes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recommend_external_dislikes" (
	"external_source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"cover_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommend_external_dislikes_external_source_external_id_pk" PRIMARY KEY("external_source","external_id"),
	CONSTRAINT "recommend_external_dislikes_source_check" CHECK ("recommend_external_dislikes"."external_source" = 'rawg'),
	CONSTRAINT "recommend_external_dislikes_title_check" CHECK (char_length("recommend_external_dislikes"."title") between 1 and 200)
);
