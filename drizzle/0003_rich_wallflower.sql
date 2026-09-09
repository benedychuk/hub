CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"resource_key" text NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"invite_link" text,
	"invite_expires_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"kicked_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_person_res_uidx" ON "memberships" USING btree ("person_id","resource_key");--> statement-breakpoint
CREATE INDEX "memberships_status_idx" ON "memberships" USING btree ("status");