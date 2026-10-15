ALTER TABLE "persons" ADD COLUMN "zen_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "zen_notes" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "zen_custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;