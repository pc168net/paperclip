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
      const connectionId = randomUUID();
      const catalogConnectionId = randomUUID();
      const unresolvedConnectionId = randomUUID();

      await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'AI deployments', 'AID'), (${catalogCompanyId}, 'AI deployments catalog', 'AIC')`;
      await sql`INSERT INTO tool_applications (id, company_id, application_key, name, type) VALUES (${applicationId}, ${companyId}, 'ai', 'AI', 'mcp_http'), (${catalogApplicationId}, ${catalogCompanyId}, 'ai', 'AI catalog', 'mcp_http')`;
      await sql`
        INSERT INTO tool_connections (
          id, company_id, application_id, name, uid, connection_kind, connection_purpose,
          transport, auth_kind, credential_source, status, enabled, health_status, created_by_user_id, config
        ) VALUES (
          ${connectionId}, ${companyId}, ${applicationId}, 'Primary AI', 'primary-ai', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${{ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'responses', auth: 'api_key', baseUrl: 'https://primary.example/v1', models: [{ id: 'azure-prod' }, { id: 'azure-prod' }, { id: 'azure-beta' }] } } }}
        ), (
          ${catalogConnectionId}, ${catalogCompanyId}, ${catalogApplicationId}, 'Catalog AI', 'catalog-ai', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${{ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'chat', auth: 'bearer', baseUrl: 'https://catalog.example/v1', models: [{ id: 'chat-prod' }] } } }}
        ), (
          ${unresolvedConnectionId}, ${companyId}, ${applicationId}, 'Legacy only', 'legacy-only', 'managed', 'ai',
          'runtime_auth', 'api_key', 'paperclip_vault', 'active', true, 'ok', 'board',
          ${{ ai: { provider: 'openai', method: 'api_key', routing: { kind: 'gateway', protocol: 'responses', auth: 'api_key', baseUrl: 'https://legacy.example/v1', models: [{ id: '' }, { id: '   ' }] } } }}
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
