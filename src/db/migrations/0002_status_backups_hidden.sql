CREATE TABLE "status_backups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "status_backups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "hidden_at" timestamp with time zone;