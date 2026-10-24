import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { aiDeployments, agents, companies, companyMemberships, createDb, toolConnections } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { aiConnectionService } from "../services/ai-connections.js";

const routing = {
  kind: "gateway" as const,
  protocol: "responses" as const,
  auth: "api_key" as const,
  baseUrl: "https://azure.example.test/openai/v1",
  models: [],
};

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let companyId: string;
let ownerId: string;

function app() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    req.actor = { type: "board", source: "local_implicit", userId: ownerId, companyIds: [companyId] };
    next();
  });
  result.use("/api", agentRoutes(db));
  result.use(errorHandler);
  return result;
}

describe("agent effective model routes", () => {
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-agent-effective-model-");
    db = createDb(database.connectionString);
    companyId = randomUUID();
    ownerId = `owner-${companyId}`;
    await db.insert(companies).values({ id: companyId, name: "Effective models", issuePrefix: "EM" });
    await db.insert(companyMemberships).values({
      companyId,
      principalId: ownerId,
      principalType: "user",
      status: "active",
      membershipRole: "owner",
    });
  }, 90_000);

  afterAll(async () => {
    await database?.cleanup();
  });

  it("projects only a verified selected deployment as an agent's effective model", async () => {
    const service = aiConnectionService(db);
    const connected = await service.save(companyId, ownerId, {
      provider: "openai",
      method: "api_key",
      ownership: "shared",
      name: "Azure production",
      apiKey: "fixture-api-key",
      routing,
      agentIds: [],
      allAgents: true,
    }, "fixture-api-key");
    const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, connected.connectionId));
    const deploymentId = randomUUID();
    const staleDeploymentId = randomUUID();
    const failedDeploymentId = randomUUID();
    await db.insert(aiDeployments).values([
      {
        id: deploymentId,
        companyId,
        connectionId: connected.connectionId,
        modelId: "gpt-5.6-terra",
        displayName: "Azure Terra",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: connection!.credentialEpoch,
        verifiedAt: new Date(),
        createdByUserId: ownerId,
        lastError: "must not be projected",
      },
      {
        id: staleDeploymentId,
        companyId,
        connectionId: connected.connectionId,
        modelId: "stale-terra",
        displayName: "Stale Terra",
        protocol: "responses",
        status: "stale",
        verifiedCredentialEpoch: connection!.credentialEpoch,
        createdByUserId: ownerId,
        lastError: "stale error must not be projected",
      },
      {
        id: failedDeploymentId,
        companyId,
        connectionId: connected.connectionId,
        modelId: "failed-terra",
        displayName: "Failed Terra",
        protocol: "responses",
        status: "failed",
        verifiedCredentialEpoch: connection!.credentialEpoch,
        createdByUserId: ownerId,
        lastError: "failed error must not be projected",
      },
    ]);
    const verifiedAgentId = randomUUID();
    const staleAgentId = randomUUID();
    const failedAgentId = randomUUID();
    const noConnectionAgentId = randomUUID();
    await db.insert(agents).values([
      {
        id: verifiedAgentId,
        companyId,
        name: "Verified runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "shared", connectionId: connected.connectionId, grantId: connected.grantId, deploymentId } },
      },
      {
        id: staleAgentId,
        companyId,
        name: "Stale runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "shared", connectionId: connected.connectionId, grantId: connected.grantId, deploymentId: staleDeploymentId } },
      },
      {
        id: failedAgentId,
        companyId,
        name: "Failed runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "shared", connectionId: connected.connectionId, grantId: connected.grantId, deploymentId: failedDeploymentId } },
      },
      {
        id: noConnectionAgentId,
        companyId,
        name: "Unconnected runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
      },
    ]);

    const list = await request(app()).get(`/api/companies/${companyId}/agents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.find((agent: { id: string }) => agent.id === verifiedAgentId)).toMatchObject({
      effectiveModel: "gpt-5.6-terra",
      modelSource: "verified_deployment",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === staleAgentId)).toMatchObject({
      effectiveModel: "gpt-5.6-sol",
      modelSource: "agent_config",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === failedAgentId)).toMatchObject({
      effectiveModel: "gpt-5.6-sol",
      modelSource: "agent_config",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === noConnectionAgentId)).toMatchObject({
      effectiveModel: "gpt-5.6-sol",
      modelSource: "agent_config",
    });

    const detail = await request(app()).get(`/api/agents/${verifiedAgentId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({ effectiveModel: "gpt-5.6-terra", modelSource: "verified_deployment" });
    expect(detail.body.effectiveModel).not.toContain("azure.example.test");
    expect(detail.body.effectiveModel).not.toContain(connected.grantId);
    expect(detail.body.effectiveModel).not.toContain("fixture-api-key");
    expect(detail.body.effectiveModel).not.toContain("must not be projected");
  }, 90_000);
});
