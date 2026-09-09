CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"file_id" text NOT NULL,
	"file_unique_id" text NOT NULL,
	"title" text,
	"caption" text,
	"width" integer,
	"height" integer,
	"duration" integer,
	"file_size" integer,
	"mime_type" text,
	"from_person_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_from_person_id_persons_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_unique_uidx" ON "media" USING btree ("file_unique_id");