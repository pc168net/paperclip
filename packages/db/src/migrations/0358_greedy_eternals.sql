CREATE TABLE "agent_role_profile_adoptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"applied_revision_id" uuid NOT NULL,
	"managed_paths" jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_role_profile_adoptions_agent_uq" UNIQUE("agent_id"),
	CONSTRAINT "agent_role_profile_adoptions_company_agent_uq" UNIQUE("company_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_role_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"managed_files" jsonb NOT NULL,
	"change_summary" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_role_profile_revisions_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "agent_role_profile_revisions_profile_revision_uq" UNIQUE("profile_id","revision_number")
);
--> statement-breakpoint
CREATE TABLE "agent_role_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_role_profiles_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "agent_role_profiles_company_key_uq" UNIQUE("company_id","key"),
	CONSTRAINT "agent_role_profiles_company_name_uq" UNIQUE("company_id","name")
);
--> statement-breakpoint
ALTER TABLE "agent_role_profile_adoptions" ADD CONSTRAINT "agent_role_profile_adoptions_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_profile_adoptions" ADD CONSTRAINT "agent_role_profile_adoptions_company_id_profile_id_agent_role_profiles_company_id_id_fk" FOREIGN KEY ("company_id","profile_id") REFERENCES "public"."agent_role_profiles"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_profile_adoptions" ADD CONSTRAINT "agent_role_profile_adoptions_company_id_applied_revision_id_agent_role_profile_revisions_company_id_id_fk" FOREIGN KEY ("company_id","applied_revision_id") REFERENCES "public"."agent_role_profile_revisions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_profile_revisions" ADD CONSTRAINT "agent_role_profile_revisions_company_id_profile_id_agent_role_profiles_company_id_id_fk" FOREIGN KEY ("company_id","profile_id") REFERENCES "public"."agent_role_profiles"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_role_profiles" ADD CONSTRAINT "agent_role_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_role_profile_adoptions_profile_idx" ON "agent_role_profile_adoptions" USING btree ("company_id","profile_id");--> statement-breakpoint
CREATE INDEX "agent_role_profile_revisions_profile_idx" ON "agent_role_profile_revisions" USING btree ("company_id","profile_id","revision_number");