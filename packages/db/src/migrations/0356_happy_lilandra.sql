ALTER TABLE "ai_deployments" ALTER COLUMN "verified_credential_epoch" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "tool_connections" ALTER COLUMN "credential_epoch" SET DEFAULT 1;