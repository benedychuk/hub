ALTER TABLE "bots" ADD COLUMN "mode" text DEFAULT 'managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "resource_key" text;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "api_key_hash" text;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "api_key_prefix" text;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "requests_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "requests_day" text;