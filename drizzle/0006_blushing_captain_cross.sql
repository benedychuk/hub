CREATE TABLE "broadcast_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"broadcast_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"button" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"broadcast_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"telegram_message_id" integer,
	"extra_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"clicked_button" integer,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ALTER COLUMN "text" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "broadcasts" ALTER COLUMN "disable_preview" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "attached_to_text" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "spoiler" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "total_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "clicked_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_clicks" ADD CONSTRAINT "broadcast_clicks_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_clicks" ADD CONSTRAINT "broadcast_clicks_recipient_id_broadcast_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."broadcast_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bcc_bc_idx" ON "broadcast_clicks" USING btree ("broadcast_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bcr_uidx" ON "broadcast_recipients" USING btree ("broadcast_id","person_id");--> statement-breakpoint
CREATE INDEX "bcr_status_idx" ON "broadcast_recipients" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX "bcr_person_idx" ON "broadcast_recipients" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "bc_status_idx" ON "broadcasts" USING btree ("status","scheduled_at");--> statement-breakpoint
UPDATE "broadcasts" SET "buttons" = coalesce((SELECT jsonb_agg(jsonb_build_object('text', b->>'text', 'type', 'link', 'url', b->>'url', 'color', 'default', 'directLink', true, 'tags', '[]'::jsonb, 'actions', '[]'::jsonb)) FROM jsonb_array_elements("buttons") b WHERE b ? 'url' AND NOT (b ? 'type')), "buttons") WHERE "buttons" <> '[]'::jsonb;--> statement-breakpoint
UPDATE "broadcasts" SET "audience" = CASE "audience"->>'kind' WHEN 'hub_active' THEN '{"subStatus":["active","trialing","past_due"]}'::jsonb WHEN 'hub_test' THEN '{"onlyAdmin":true}'::jsonb ELSE '{}'::jsonb END WHERE "audience" ? 'kind';--> statement-breakpoint
UPDATE "broadcasts" SET "total_count" = "sent_count" + "failed_count", "started_at" = coalesce("scheduled_at", "created_at"), "finished_at" = coalesce("scheduled_at", "created_at") WHERE "status" IN ('sent','failed') AND "total_count" = 0;
