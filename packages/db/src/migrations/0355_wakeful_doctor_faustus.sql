CREATE TABLE "ai_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text,
	"protocol" text NOT NULL,
	"status" text DEFAULT 'stale' NOT NULL,
	"verified_credential_epoch" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"verified_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_deployments_company_connection_model_protocol_uq" UNIQUE("company_id","connection_id","model_id","protocol"),
	CONSTRAINT "ai_deployments_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "ai_deployments_status_check" CHECK ("status" in ('stale', 'verified', 'failed')),
	CONSTRAINT "ai_deployments_protocol_check" CHECK ("protocol" in ('responses', 'chat'))
);
--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_company_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."tool_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD COLUMN "credential_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Legacy routing.models were only a provider catalog. Preserve their names as
-- explicit stale deployment candidates; an owner must run the real
-- Responses/Chat probe before an agent can select one.
INSERT INTO "ai_deployments" ("company_id", "connection_id", "model_id", "protocol", "created_by_user_id")
SELECT
  connection."company_id",
  connection."id",
  trim(model.value->>'id'),
  connection."config"->'ai'->'routing'->>'protocol',
  connection."created_by_user_id"
FROM "tool_connections" AS connection
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(connection."config"->'ai'->'routing'->'models') = 'array'
    THEN connection."config"->'ai'->'routing'->'models'
    ELSE '[]'::jsonb END
) AS model(value)
WHERE connection."connection_purpose" = 'ai'
  AND connection."config"->'ai'->'routing'->>'kind' IN ('gateway', 'local')
  AND connection."config"->'ai'->'routing'->>'protocol' IN ('responses', 'chat')
  AND trim(coalesce(model.value->>'id', '')) <> ''
ON CONFLICT ("company_id", "connection_id", "model_id", "protocol") DO NOTHING;--> statement-breakpoint
