CREATE TABLE "funnel_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"funnel_id" integer NOT NULL,
	"command" text NOT NULL,
	"description" text,
	"action" jsonb DEFAULT '{"type":"text","text":""}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"funnel_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funnels" ALTER COLUMN "is_active" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD COLUMN "extra_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funnel_enrollments" ADD COLUMN "awaiting_step_id" integer;--> statement-breakpoint
ALTER TABLE "funnel_enrollments" ADD COLUMN "last_step_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funnel_steps" ADD COLUMN "module_id" integer;--> statement-breakpoint
ALTER TABLE "funnel_steps" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_steps" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "button_text" text;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "funnels" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "funnel_commands" ADD CONSTRAINT "funnel_commands_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_modules" ADD CONSTRAINT "funnel_modules_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_steps" ADD CONSTRAINT "funnel_steps_module_id_funnel_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."funnel_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_folder_id_funnel_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."funnel_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fd_delete_idx" ON "funnel_deliveries" USING btree ("delete_at");--> statement-breakpoint
CREATE INDEX "funnels_folder_idx" ON "funnels" USING btree ("folder_id");--> statement-breakpoint
UPDATE "funnels" SET "status" = CASE WHEN "is_active" THEN 'active' ELSE 'stopped' END, "button_text" = coalesce("button_text", 'Отримати доступ');--> statement-breakpoint
UPDATE "funnel_steps" SET "config" = (
  "config" - 'timing' - 'delay' - 'at' - 'mediaId' - 'disablePreview'
  || jsonb_build_object(
    'sendTime', CASE
      WHEN "config"->'delay' IS NULL THEN jsonb_build_object('mode','immediately')
      WHEN coalesce(("config"->'delay'->>'value')::int, 0) = 0 AND "config"->>'timing' IS DISTINCT FROM 'at' THEN jsonb_build_object('mode','immediately')
      WHEN "config"->>'timing' = 'at' THEN jsonb_build_object('mode','exact','day', greatest(coalesce(("config"->'delay'->>'value')::int,1),0),'time', lpad(coalesce("config"->'at'->>'hour','12'),2,'0') || ':' || lpad(coalesce("config"->'at'->>'minute','0'),2,'0'))
      ELSE jsonb_build_object('mode','after','value', ("config"->'delay'->>'value')::int, 'unit', coalesce("config"->'delay'->>'unit','days')) END,
    'autodelete', jsonb_build_object('mode','never'),
    'preview', NOT coalesce(("config"->>'disablePreview')::boolean, true),
    'attachments', CASE WHEN ("config"->>'mediaId') IS NOT NULL THEN jsonb_build_array(("config"->>'mediaId')::int) ELSE '[]'::jsonb END,
    'buttons', coalesce((SELECT jsonb_agg(CASE
        WHEN b->>'url' IS NOT NULL THEN jsonb_build_object('text', b->>'text', 'kind', 'url', 'target', b->>'url', 'tag', b->'tag')
        WHEN b->>'kind' = 'goto' THEN jsonb_build_object('text', b->>'text', 'kind', 'step', 'target', b->'target', 'tag', b->'tag')
        ELSE jsonb_build_object('text', b->>'text', 'kind', coalesce(b->>'kind','next'), 'target', b->'target', 'tag', b->'tag') END)
      FROM jsonb_array_elements(coalesce("config"->'buttons','[]'::jsonb)) b), '[]'::jsonb)
  )
) WHERE "config" ? 'timing' OR "config" ? 'delay' OR "config" ? 'mediaId';
