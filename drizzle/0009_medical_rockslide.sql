CREATE TABLE "access_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"token" text NOT NULL,
	"name" text,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"mark_as_payment" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "subs_person_source_uidx";--> statement-breakpoint
ALTER TABLE "funnel_folders" ADD COLUMN "kind" text DEFAULT 'funnel' NOT NULL;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "kind" text DEFAULT 'funnel' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "payment_type" text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "products" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "access_mode" text DEFAULT 'forever' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "access_days" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "access_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sales_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "spots_limit" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "show_in_bot" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "design" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "kind" text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "access_link_id" integer;--> statement-breakpoint
ALTER TABLE "access_links" ADD CONSTRAINT "access_links_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_links_token_uidx" ON "access_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "access_links_plan_idx" ON "access_links" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "subs_person_source_idx" ON "subscriptions" USING btree ("person_id","source");