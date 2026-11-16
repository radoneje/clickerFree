ALTER TABLE "pairing_requests" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "os" "worker_os" NOT NULL;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "arch" "worker_arch" NOT NULL;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "app_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "protocol_version" integer NOT NULL;