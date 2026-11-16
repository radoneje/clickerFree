ALTER TABLE "usage_events" ADD COLUMN "install_id" uuid;--> statement-breakpoint
ALTER TABLE "worker_releases" ADD COLUMN "manifest_url" text;