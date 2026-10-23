import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { aiDeployments, companies, toolApplications, toolConnections } from "./schema/index.js";
import { eq } from "drizzle-orm";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;

async function runMigration(sql: postgres.Sql<{}>, file: string) {
  const content = await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");
  for (const statement of content.split("--> statement-breakpoint")) {
    await sql.unsafe(statement);
  }
}

afterAll(async () => {
  await database?.cleanup();
});

describeEmbeddedPostgres("AI deployment migration backfill", () => {
  it("upgrades an existing partial deployment table without recreating it", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-deployments-upgrade-");
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      await sql`DROP TABLE IF EXISTS ai_deployments CASCADE`;
      await sql`ALTER TABLE tool_connections DROP COLUMN IF EXISTS credential_epoch`;
      await sql`
        CREATE TABLE ai_deployments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          connection_id uuid NOT NULL REFERENCES tool_connections(id) ON DELETE CASCADE,
          model_id text NOT NULL,
          protocol text NOT NULL,
          status text NOT NULL DEFAULT 'unverified',
          verification_error text,
          verified_at timestamptz,
          created_by_user_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (company_id, connection_id, model_id, protocol),
          UNIQUE (company_id, id),
          UNIQUE (company_id, connection_id, status),
          CONSTRAINT ai_deployments_company_connection_fk
            FOREIGN KEY (company_id, connection_id) REFERENCES tool_connections(company_id, id) ON DELETE CASCADE
        )
      `;

      const companyId = randomUUID();
      const applicationId = randomUUID();
      const connectionId = randomUUID();
      await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'Upgrade test', 'UPG')`;
      await sql`INSERT INTO tool_applications (id, company_id, application_key, name, type) VALUES (${applicationId}, ${companyId}, 'ai', 'AI', 'mcp_http')`;
      await sql`
        INSERT INTO tool_connections (
          id, company_id, application_id, name, uid, connection_kind, connection_purpose,
          transport, auth_kind, credential_source, status, enabled, health_status, created_by_user_id, config
        ) VALUES (
          ${connectionId}, ${companyId}, ${applicationId}, 'Upgrade AI', 'upgrade-ai', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${sql.json({ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'responses', auth: 'api_key', baseUrl: 'https://upgrade.example/v1', models: [{ id: 'upgrade-model' }] } } })}
        )
      `;
      await sql`
        INSERT INTO ai_deployments (company_id, connection_id, model_id, protocol, status, verification_error, created_by_user_id)
        VALUES (${companyId}, ${connectionId}, 'upgrade-model', 'responses', 'unverified', 'old provider error', 'board')
      `;

      await runMigration(sql, "0355_wakeful_doctor_faustus.sql");
      await runMigration(sql, "0356_happy_lilandra.sql");

      const db = createDb(database.connectionString);
      const [row] = await db.select().from(aiDeployments).where(eq(aiDeployments.connectionId, connectionId));
      expect(row).toMatchObject({
        modelId: "upgrade-model",
        protocol: "responses",
        status: "stale",
        lastError: "old provider error",
        verifiedAt: null,
        verifiedCredentialEpoch: 1,
      });
    } finally {
      await sql.end();
      await database.cleanup();
      database = undefined;
    }
  }, 60_000);

  it("backfills legacy routing models as stale rows once, dedupes catalog repeats, and leaves unresolved legacy models untouched", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-deployments-migration-");
    const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
    try {
      await sql`DROP TABLE IF EXISTS ai_deployments CASCADE`;
      await sql`ALTER TABLE tool_connections DROP COLUMN IF EXISTS credential_epoch`;

      const companyId = randomUUID();
      const catalogCompanyId = randomUUID();
      const applicationId = randomUUID();
      const catalogApplicationId = randomUUID();
      const azureApplicationId = randomUUID();
      const connectionId = randomUUID();
      const catalogConnectionId = randomUUID();
      const azureConnectionId = randomUUID();
      const unresolvedConnectionId = randomUUID();

      await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'AI deployments', 'AID'), (${catalogCompanyId}, 'AI deployments catalog', 'AIC')`;
      await sql`INSERT INTO tool_applications (id, company_id, application_key, name, type) VALUES (${applicationId}, ${companyId}, 'ai', 'AI', 'mcp_http'), (${catalogApplicationId}, ${catalogCompanyId}, 'ai', 'AI catalog', 'mcp_http'), (${azureApplicationId}, ${catalogCompanyId}, 'ai-azure', 'Azure AI', 'mcp_http')`;
      await sql`
        INSERT INTO tool_connections (
          id, company_id, application_id, name, uid, connection_kind, connection_purpose,
          transport, auth_kind, credential_source, status, enabled, health_status, created_by_user_id, config
        ) VALUES (
          ${connectionId}, ${companyId}, ${applicationId}, 'Primary AI', 'primary-ai', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${sql.json({ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'responses', auth: 'api_key', baseUrl: 'https://primary.example/v1', models: [{ id: 'azure-prod' }, { id: 'azure-prod' }, { id: 'azure-beta' }] } } })}
        ), (
          ${catalogConnectionId}, ${catalogCompanyId}, ${catalogApplicationId}, 'Catalog AI', 'catalog-ai', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${sql.json({ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'chat', auth: 'bearer', baseUrl: 'https://catalog.example/v1', models: [{ id: 'chat-prod' }] } } })}
        ), (
          ${azureConnectionId}, ${catalogCompanyId}, ${azureApplicationId}, 'Azure AI', 'azure-ai', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${sql.json({ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'responses', auth: 'api_key', baseUrl: 'https://resource.openai.azure.com/v1', models: [{ id: 'azure-eastus' }, { id: 'azure-eastus' }, { id: 'azure-westus' }] } } })}
        ), (
          ${unresolvedConnectionId}, ${companyId}, ${applicationId}, 'Legacy only', 'legacy-only', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${sql.json({ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'responses', auth: 'api_key', baseUrl: 'https://legacy.example/v1', models: [{ id: '' }, { id: '   ' }] } } })}
        )
      `;

      await runMigration(sql, "0355_wakeful_doctor_faustus.sql");
      await runMigration(sql, "0356_happy_lilandra.sql");

      const db = createDb(database.connectionString);
      const primaryRows = await db.select().from(aiDeployments).where(eq(aiDeployments.connectionId, connectionId));
      expect(primaryRows.map((row) => ({ modelId: row.modelId, status: row.status, verifiedCredentialEpoch: row.verifiedCredentialEpoch, createdByUserId: row.createdByUserId })).sort((a, b) => a.modelId.localeCompare(b.modelId))).toEqual([
        { modelId: 'azure-beta', status: 'stale', verifiedCredentialEpoch: 1, createdByUserId: 'board' },
        { modelId: 'azure-prod', status: 'stale', verifiedCredentialEpoch: 1, createdByUserId: 'board' },
      ]);

      const catalogRows = await db.select().from(aiDeployments).where(eq(aiDeployments.connectionId, catalogConnectionId));
      expect(catalogRows).toEqual([
        { id: expect.any(String), companyId: catalogCompanyId, connectionId: catalogConnectionId, modelId: 'chat-prod', displayName: null, protocol: 'chat', status: 'stale', verifiedCredentialEpoch: 1, lastError: null, verifiedAt: null, createdByUserId: 'board', createdAt: expect.any(Date), updatedAt: expect.any(Date) },
      ]);

      const azureRows = await db.select().from(aiDeployments).where(eq(aiDeployments.connectionId, azureConnectionId));
      expect(azureRows.map((row) => ({ modelId: row.modelId, status: row.status, verifiedCredentialEpoch: row.verifiedCredentialEpoch })).sort((a, b) => a.modelId.localeCompare(b.modelId))).toEqual([
        { modelId: 'azure-eastus', status: 'stale', verifiedCredentialEpoch: 1 },
        { modelId: 'azure-westus', status: 'stale', verifiedCredentialEpoch: 1 },
      ]);

      const unresolvedRows = await db.select().from(aiDeployments).where(eq(aiDeployments.connectionId, unresolvedConnectionId));
      expect(unresolvedRows).toHaveLength(0);

      const uniqueModels = await db.select({ modelId: aiDeployments.modelId }).from(aiDeployments).where(eq(aiDeployments.connectionId, connectionId));
      expect(uniqueModels.map((row) => row.modelId).sort()).toEqual(['azure-beta', 'azure-prod']);
      expect(uniqueModels).toHaveLength(2);
    } finally {
      await sql.end();
      await database.cleanup();
      database = undefined;
    }
  }, 60_000);
});
