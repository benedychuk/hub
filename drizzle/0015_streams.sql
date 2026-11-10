CREATE TABLE "stream_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"stream_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"via" text DEFAULT 'bot' NOT NULL,
	"clicks" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streams" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"youtube_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stream_visits" ADD CONSTRAINT "stream_visits_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_visits" ADD CONSTRAINT "stream_visits_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stream_visits_uidx" ON "stream_visits" USING btree ("stream_id","person_id");--> statement-breakpoint
CREATE INDEX "stream_visits_person_idx" ON "stream_visits" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "streams_code_uidx" ON "streams" USING btree ("code");--> statement-breakpoint
CREATE INDEX "streams_starts_idx" ON "streams" USING btree ("starts_at");