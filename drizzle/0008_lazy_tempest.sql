CREATE TABLE "payment_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_reference" text NOT NULL,
	"person_id" integer NOT NULL,
	"plan_id" integer,
	"subscription_id" integer,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"reason_code" text,
	"reason" text,
	"card_pan" text,
	"rec_token" text,
	"order_id" integer,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"provider" text DEFAULT 'wayforpay' NOT NULL,
	"rec_token" text NOT NULL,
	"card_pan" text,
	"card_type" text,
	"bank" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method_id" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_charge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "reminded_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "migrated_from_zen" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "zen_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pa_ref_uidx" ON "payment_attempts" USING btree ("order_reference");--> statement-breakpoint
CREATE INDEX "pa_person_idx" ON "payment_attempts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "pa_status_idx" ON "payment_attempts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_token_uidx" ON "payment_methods" USING btree ("person_id","rec_token");--> statement-breakpoint
CREATE INDEX "pm_person_idx" ON "payment_methods" USING btree ("person_id");