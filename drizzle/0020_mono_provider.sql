ALTER TABLE "payment_attempts" ADD COLUMN "provider" text DEFAULT 'wayforpay' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "provider_ref" text;