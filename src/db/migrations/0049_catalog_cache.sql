CREATE TABLE "catalog_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_cache_key_check" CHECK (char_length("catalog_cache"."cache_key") between 1 and 256),
	CONSTRAINT "catalog_cache_kind_check" CHECK ("catalog_cache"."kind" in ('upcoming', 'search', 'game', 'meta'))
);
--> statement-breakpoint
CREATE INDEX "catalog_cache_fetched_idx" ON "catalog_cache" USING btree ("fetched_at");