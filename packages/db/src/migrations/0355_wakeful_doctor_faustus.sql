CREATE TABLE IF NOT EXISTS "ai_deployments" (
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
DO $$
DECLARE
	company_id_attnum smallint;
	connection_id_attnum smallint;
BEGIN
	SELECT attnum INTO company_id_attnum
	FROM pg_attribute
	WHERE attrelid = 'ai_deployments'::regclass
		AND attname = 'company_id'
		AND NOT attisdropped;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		WHERE c.conrelid = 'ai_deployments'::regclass
			AND c.contype = 'f'
			AND c.conkey = ARRAY[company_id_attnum]
	) THEN
		ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;

	SELECT attnum INTO connection_id_attnum
	FROM pg_attribute
	WHERE attrelid = 'ai_deployments'::regclass
		AND attname = 'connection_id'
		AND NOT attisdropped;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		WHERE c.conrelid = 'ai_deployments'::regclass
			AND c.contype = 'f'
			AND c.conkey = ARRAY[connection_id_attnum]
	) THEN
		ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		WHERE c.conrelid = 'ai_deployments'::regclass
			AND c.contype = 'f'
			AND c.conkey = ARRAY[company_id_attnum, connection_id_attnum]
	) THEN
		ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_company_connection_fk" FOREIGN KEY ("company_id","connection_id") REFERENCES "public"."tool_connections"("company_id","id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD COLUMN IF NOT EXISTS "credential_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD COLUMN IF NOT EXISTS "display_name" text;--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD COLUMN IF NOT EXISTS "verified_credential_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_deployments" DROP CONSTRAINT IF EXISTS "ai_deployments_company_id_connection_id_status_key";--> statement-breakpoint
UPDATE "ai_deployments" SET "status" = 'stale' WHERE "status" = 'unverified';--> statement-breakpoint
ALTER TABLE "ai_deployments" ALTER COLUMN "status" SET DEFAULT 'stale';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'ai_deployments'
			AND column_name = 'verification_error'
	) THEN
		IF EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
				AND table_name = 'ai_deployments'
				AND column_name = 'last_error'
		) THEN
			EXECUTE 'UPDATE "ai_deployments" SET "last_error" = COALESCE("last_error", "verification_error") WHERE "verification_error" IS NOT NULL';
		ELSE
			EXECUTE 'ALTER TABLE "ai_deployments" RENAME COLUMN "verification_error" TO "last_error"';
		END IF;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ai_deployments" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = 'public'
			AND t.relname = 'ai_deployments'
			AND c.conname = 'ai_deployments_status_check'
	) THEN
		ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_status_check" CHECK ("status" in ('stale', 'verified', 'failed'));
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint c
		JOIN pg_class t ON t.oid = c.conrelid
		JOIN pg_namespace n ON n.oid = t.relnamespace
		WHERE n.nspname = 'public'
			AND t.relname = 'ai_deployments'
			AND c.conname = 'ai_deployments_protocol_check'
	) THEN
		ALTER TABLE "ai_deployments" ADD CONSTRAINT "ai_deployments_protocol_check" CHECK ("protocol" in ('responses', 'chat'));
	END IF;
END $$;--> statement-breakpoint
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
