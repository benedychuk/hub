CREATE TABLE "onboarding_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer,
	"name" text,
	"contact" text,
	"contact_norm" text,
	"password_hash" text,
	"link_code" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"quiz_result_id" integer,
	"quiz_scenario" text,
	"quiz" jsonb DEFAULT '{}'::jsonb,
	"quiz_started_at" timestamp with time zone,
	"quiz_completed_at" timestamp with time zone,
	"deep_quiz" jsonb DEFAULT '{}'::jsonb,
	"deep_quiz_completed_at" timestamp with time zone,
	"diagnostic_completed_at" timestamp with time zone,
	"feedback" jsonb,
	"feedback_at" timestamp with time zone,
	"shchyro_synced_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_accounts" ADD CONSTRAINT "onboarding_accounts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ob_person_uidx" ON "onboarding_accounts" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ob_link_uidx" ON "onboarding_accounts" USING btree ("link_code");--> statement-breakpoint
CREATE INDEX "ob_contact_idx" ON "onboarding_accounts" USING btree ("contact_norm");--> statement-breakpoint
CREATE INDEX "ob_trial_idx" ON "onboarding_accounts" USING btree ("trial_ends_at");