CREATE TABLE "funnel_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"funnel_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tag" text,
	"joins" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funnel_links" ADD CONSTRAINT "funnel_links_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funnel_links_slug_uidx" ON "funnel_links" USING btree ("funnel_id","slug");