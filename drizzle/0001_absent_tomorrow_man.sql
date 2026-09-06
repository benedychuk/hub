CREATE TABLE "funnel_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"enrollment_id" integer NOT NULL,
	"step_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"telegram_message_id" integer,
	"clicked" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"funnel_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_position" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"stop_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD CONSTRAINT "funnel_deliveries_enrollment_id_funnel_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."funnel_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_deliveries" ADD CONSTRAINT "funnel_deliveries_step_id_funnel_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."funnel_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_enrollments" ADD CONSTRAINT "funnel_enrollments_funnel_id_funnels_id_fk" FOREIGN KEY ("funnel_id") REFERENCES "public"."funnels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_enrollments" ADD CONSTRAINT "funnel_enrollments_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fd_step_idx" ON "funnel_deliveries" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "fe_due_idx" ON "funnel_enrollments" USING btree ("status","next_at");--> statement-breakpoint
CREATE INDEX "fe_person_idx" ON "funnel_enrollments" USING btree ("person_id");