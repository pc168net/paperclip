import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { aiDeployments, toolConnections } from "./schema/index.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

describe("AI deployment schema", () => {
  it("declares the normalized deployment and credential epoch contract", () => {
    const deploymentColumns = getTableConfig(aiDeployments).columns.map((column) => column.name);
    const connectionColumns = getTableConfig(toolConnections).columns.map((column) => column.name);

    expect(deploymentColumns).toEqual(expect.arrayContaining([
      "company_id",
      "connection_id",
      "model_id",
      "display_name",
      "protocol",
      "status",
      "verified_at",
      "verified_credential_epoch",
      "last_error",
      "created_by_user_id",
      "created_at",
      "updated_at",
    ]));
    expect(getTableConfig(aiDeployments).columns.find((column) => column.name === "status")?.default).toBe("stale");
    expect(getTableConfig(aiDeployments).columns.find((column) => column.name === "protocol")?.notNull).toBe(true);
    expect(connectionColumns).toContain("credential_epoch");
    expect(getTableConfig(toolConnections).columns.find((column) => column.name === "credential_epoch")?.default).toBe(1);
  });

  describeEmbeddedPostgres("enforces company-scoped deployment rows", () => {
    it("accepts same-company deployment rows, rejects cross-company pairs, and keeps the unique model/protocol key", async () => {
      const database = await startEmbeddedPostgresTestDatabase("paperclip-ai-deployments-schema-");
      const sql = postgres(database.connectionString, { max: 1 });
      try {
        const companyId = randomUUID();
        const otherCompanyId = randomUUID();
        const applicationId = randomUUID();
        const connectionId = randomUUID();

        await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${companyId}, 'Paperclip', 'PCL')`;
        await sql`INSERT INTO companies (id, name, issue_prefix) VALUES (${otherCompanyId}, 'Other', 'OTH')`;
        await sql`INSERT INTO tool_applications (id, company_id, application_key, name, type) VALUES (${applicationId}, ${companyId}, 'ai', 'AI', 'mcp_http')`;
        await sql`
          INSERT INTO tool_connections (id, company_id, application_id, name, uid, connection_purpose, transport, status, enabled)
          VALUES (${connectionId}, ${companyId}, ${applicationId}, 'AI', 'ai/primary', 'ai', 'runtime_auth', 'active', true)
        `;

        await sql`
          INSERT INTO ai_deployments (
            company_id,
            connection_id,
            model_id,
            display_name,
            protocol,
            status,
            verified_credential_epoch,
            created_by_user_id
          ) VALUES (
            ${companyId},
            ${connectionId},
            'gpt-5',
            'Primary deployment',
            'responses',
            'stale',
            1,
            'board'
          )
        `;

        await expect(sql`
          INSERT INTO ai_deployments (
            company_id,
            connection_id,
            model_id,
            display_name,
            protocol,
            status,
            verified_credential_epoch
          ) VALUES (
            ${otherCompanyId},
            ${connectionId},
            'gpt-5',
            'Foreign deployment',
            'responses',
            'stale',
            1
          )
        `).rejects.toMatchObject({ code: "23503" });

        await expect(sql`
          INSERT INTO ai_deployments (
            company_id,
            connection_id,
            model_id,
            display_name,
            protocol,
            status,
            verified_credential_epoch
          ) VALUES (
            ${companyId},
            ${connectionId},
            'gpt-5',
            'Duplicate deployment',
            'responses',
            'stale',
            1
          )
        `).rejects.toMatchObject({ code: "23505" });

        const [row] = await sql<{ company_id: string; connection_id: string; model_id: string; status: string }[]>`
          SELECT company_id, connection_id, model_id, status
          FROM ai_deployments
          WHERE company_id = ${companyId} AND connection_id = ${connectionId}
        `;
        expect(row).toEqual({ company_id: companyId, connection_id: connectionId, model_id: 'gpt-5', status: 'stale' });
      } finally {
        await sql.end();
        await database.cleanup();
      }
    }, 30_000);
  });
});
