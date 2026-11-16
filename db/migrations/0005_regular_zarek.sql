ALTER TABLE "control_sessions" ADD COLUMN "usage_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "control_sessions" ADD COLUMN "usage_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "download_events" ADD COLUMN "suspicious" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "suspicious" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;