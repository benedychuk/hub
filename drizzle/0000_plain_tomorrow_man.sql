CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"action" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"once_per_person" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"role" text DEFAULT 'club' NOT NULL,
	"webhook_set_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bots_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bot_key" text DEFAULT 'hub' NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"text" text NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"protect_content" boolean DEFAULT false NOT NULL,
	"disable_preview" boolean DEFAULT true NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"resource_key" text NOT NULL,
	"subscription_id" integer,
	"granted_by" text DEFAULT 'subscription' NOT NULL,
	"quota" text,
	"valid_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer,
	"type" text NOT NULL,
	"source" text DEFAULT 'hub' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"funnel_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'message' NOT NULL,
	"title" text,
	"body" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnels" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'hub' NOT NULL,
	"zen_funnel_id" integer,
	"name" text NOT NULL,
	"entry" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"subscribers_count" integer DEFAULT 0 NOT NULL,
	"steps_count" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"bot_key" text NOT NULL,
	"chat_id" bigint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone,
	"last_message_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'zenedu' NOT NULL,
	"zen_offer_id" integer,
	"plan_id" integer,
	"name" text NOT NULL,
	"price" numeric(12, 2),
	"currency" text,
	"is_subscription" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"link" text,
	"landing_link" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'zenedu' NOT NULL,
	"zen_order_id" integer,
	"person_id" integer,
	"offer_id" integer,
	"offer_name" text,
	"type" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"payment_system" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"first_name" text,
	"last_name" text,
	"username" text,
	"phone" text,
	"email" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"zen_subscriber_id" integer,
	"zen_is_active" boolean,
	"zen_is_blocked" boolean,
	"utm" jsonb DEFAULT '[]'::jsonb,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"last_active_at" timestamp with time zone,
	"zen_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"period" text DEFAULT 'month' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"trial_price" numeric(12, 2),
	"entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "resources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"plan_id" integer,
	"offer_id" integer,
	"source" text DEFAULT 'zenedu' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"period_days" integer DEFAULT 31 NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"last_payment_at" timestamp with time zone,
	"payments_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_steps" ADD CONSTRAINT "funnel_steps_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ent_person_idx" ON "entitlements" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "ent_res_idx" ON "entitlements" USING btree ("resource_key");--> statement-breakpoint
CREATE INDEX "events_person_idx" ON "events" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "funnels_zen_uidx" ON "funnels" USING btree ("zen_funnel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_person_bot_uidx" ON "identities" USING btree ("person_id","bot_key");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_zen_uidx" ON "offers" USING btree ("zen_offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_zen_uidx" ON "orders" USING btree ("zen_order_id");--> statement-breakpoint
CREATE INDEX "orders_person_idx" ON "orders" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_tg_uidx" ON "persons" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE INDEX "persons_username_idx" ON "persons" USING btree ("username");--> statement-breakpoint
CREATE INDEX "persons_zen_idx" ON "persons" USING btree ("zen_subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subs_person_source_uidx" ON "subscriptions" USING btree ("person_id","source");--> statement-breakpoint
CREATE INDEX "subs_status_idx" ON "subscriptions" USING btree ("status");