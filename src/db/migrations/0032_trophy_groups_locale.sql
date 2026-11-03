CREATE TABLE "trophy_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trophy_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"trophy_set_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"group_id" text NOT NULL,
	"name" text,
	"detail" text,
	"icon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trophy_set_locales" (
	"trophy_set_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trophy_set_locales_user_id_trophy_set_id_pk" PRIMARY KEY("user_id","trophy_set_id")
);
--> statement-breakpoint
ALTER TABLE "trophy_groups" ADD CONSTRAINT "trophy_groups_trophy_set_id_trophy_sets_id_fk" FOREIGN KEY ("trophy_set_id") REFERENCES "public"."trophy_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_groups" ADD CONSTRAINT "trophy_groups_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_groups" ADD CONSTRAINT "trophy_groups_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_set_locales" ADD CONSTRAINT "trophy_set_locales_trophy_set_id_trophy_sets_id_fk" FOREIGN KEY ("trophy_set_id") REFERENCES "public"."trophy_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_set_locales" ADD CONSTRAINT "trophy_set_locales_user_id_allowed_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."allowed_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trophy_set_locales" ADD CONSTRAINT "trophy_set_locales_user_set_fk" FOREIGN KEY ("user_id","trophy_set_id") REFERENCES "public"."trophy_sets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trophy_groups_user_set_group_key" ON "trophy_groups" USING btree ("user_id","trophy_set_id","group_id");