CREATE INDEX IF NOT EXISTS "ent_person_res_idx" ON "entitlements" USING btree ("person_id","resource_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_created_idx" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_person_type_idx" ON "events" USING btree ("person_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pa_sub_idx" ON "payment_attempts" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pa_order_idx" ON "payment_attempts" USING btree ("order_id");