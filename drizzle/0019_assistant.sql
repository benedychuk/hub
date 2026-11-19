CREATE TABLE "assistant_threads" (
	"person_id" integer PRIMARY KEY NOT NULL,
	"pending_since" timestamp with time zone,
	"last_in_at" timestamp with time zone,
	"reason" text,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"silent" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"team_note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_threads" ADD CONSTRAINT "assistant_threads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tickets" ADD CONSTRAINT "assistant_tickets_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_threads_pending_idx" ON "assistant_threads" USING btree ("pending_since");--> statement-breakpoint
CREATE INDEX "assistant_tickets_status_idx" ON "assistant_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "assistant_tickets_person_idx" ON "assistant_tickets" USING btree ("person_id");