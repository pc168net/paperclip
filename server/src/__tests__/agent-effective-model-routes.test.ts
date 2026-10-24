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

function app(actor: Express.Request["actor"] = {
  type: "board",
  source: "local_implicit",
  userId: ownerId,
  companyIds: [companyId],
}) {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    req.actor = actor;
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
    const personal = await service.save(companyId, ownerId, {
      provider: "openai",
      method: "api_key",
      ownership: "personal",
      name: "Personal Azure",
      apiKey: "personal-fixture-api-key",
      routing,
      agentIds: [],
      allAgents: true,
    }, "personal-fixture-api-key");
    const [personalConnection] = await db.select().from(toolConnections).where(eq(toolConnections.id, personal.connectionId));
    const deploymentId = randomUUID();
    const staleDeploymentId = randomUUID();
    const failedDeploymentId = randomUUID();
    const personalDeploymentId = randomUUID();
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
      {
        id: personalDeploymentId,
        companyId,
        connectionId: personal.connectionId,
        modelId: "personal-terra",
        displayName: "Personal Terra",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: personalConnection!.credentialEpoch,
        verifiedAt: new Date(),
        createdByUserId: ownerId,
      },
    ]);
    const verifiedAgentId = randomUUID();
    const staleAgentId = randomUUID();
    const failedAgentId = randomUUID();
    const noConnectionAgentId = randomUUID();
    const routerAgentId = randomUUID();
    const incompatibleBindingAgentId = randomUUID();
    const methodMismatchAgentId = randomUUID();
    const wrongOwnershipAgentId = randomUUID();
    const sharedPersonalAgentId = randomUUID();
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
      {
        id: routerAgentId,
        companyId,
        name: "Routed runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { mode: "router", connectionId: randomUUID() } },
      },
      {
        id: incompatibleBindingAgentId,
        companyId,
        name: "Incompatible binding runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "anthropic", method: "api_key", mode: "shared", connectionId: connected.connectionId, grantId: connected.grantId, deploymentId } },
      },
      {
        id: wrongOwnershipAgentId,
        companyId,
        name: "Wrong ownership runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "openai", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "delegated", connectionId: connected.connectionId, grantId: connected.grantId, deploymentId } },
      },
      {
        id: methodMismatchAgentId,
        companyId,
        name: "Wrong method runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "openai", method: "subscription", mode: "shared", connectionId: connected.connectionId, grantId: connected.grantId, deploymentId } },
      },
      {
        id: sharedPersonalAgentId,
        companyId,
        name: "Shared personal runner",
        adapterType: "paperclip_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeConfig: { aiConnection: { provider: "openai", method: "api_key", mode: "shared", connectionId: personal.connectionId, grantId: personal.grantId, deploymentId: personalDeploymentId } },
      },
    ]);

    const list = await request(app()).get(`/api/companies/${companyId}/agents`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.find((agent: { id: string }) => agent.id === verifiedAgentId)).toMatchObject({
      effectiveModel: "gpt-5.6-terra",
      modelSource: "verified_deployment",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === staleAgentId)).toMatchObject({
      effectiveModel: null,
      modelSource: "adapter_default",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === failedAgentId)).toMatchObject({
      effectiveModel: null,
      modelSource: "adapter_default",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === noConnectionAgentId)).toMatchObject({
      effectiveModel: "gpt-5.6-sol",
      modelSource: "agent_config",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === routerAgentId)).toEqual(expect.objectContaining({
      effectiveModel: null,
      modelSource: "adapter_default",
    }));
    expect(list.body.find((agent: { id: string }) => agent.id === incompatibleBindingAgentId)).toMatchObject({
      effectiveModel: null,
      modelSource: "adapter_default",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === wrongOwnershipAgentId)).toMatchObject({
      effectiveModel: null,
      modelSource: "adapter_default",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === methodMismatchAgentId)).toMatchObject({
      effectiveModel: null,
      modelSource: "adapter_default",
    });
    expect(list.body.find((agent: { id: string }) => agent.id === sharedPersonalAgentId)).toMatchObject({
      effectiveModel: null,
      modelSource: "adapter_default",
    });

    const detail = await request(app()).get(`/api/agents/${verifiedAgentId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect({ effectiveModel: detail.body.effectiveModel, modelSource: detail.body.modelSource }).toEqual({
      effectiveModel: "gpt-5.6-terra",
      modelSource: "verified_deployment",
    });

    const restrictedUserId = `viewer-${companyId}`;
    const restrictedAgentId = randomUUID();
    await db.insert(companyMemberships).values({
      companyId,
      principalId: restrictedUserId,
      principalType: "user",
      status: "active",
      membershipRole: "viewer",
    });
    await db.insert(agents).values({
      id: restrictedAgentId,
      companyId,
      name: "Restricted viewer",
      adapterType: "process",
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalId: restrictedAgentId,
      principalType: "agent",
      status: "active",
      membershipRole: "member",
    });
    const restrictedActor: Express.Request["actor"] = {
      type: "agent",
      source: "agent_jwt",
      agentId: restrictedAgentId,
      companyId,
      onBehalfOfUserId: restrictedUserId,
      onBehalfOfMemberships: [{ companyId, membershipRole: "viewer", status: "active" }],
    };
    const restrictedList = await request(app(restrictedActor)).get(`/api/companies/${companyId}/agents`);
    const restrictedDetail = await request(app(restrictedActor)).get(`/api/agents/${verifiedAgentId}`);
    for (const response of [restrictedList, restrictedDetail]) {
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const projected = Array.isArray(response.body)
        ? response.body.find((agent: { id: string }) => agent.id === verifiedAgentId)
        : response.body;
      expect({ effectiveModel: projected.effectiveModel, modelSource: projected.modelSource }).toEqual({
        effectiveModel: "gpt-5.6-terra",
        modelSource: "verified_deployment",
      });
      expect(projected.runtimeConfig).toEqual({});
      expect(JSON.stringify(projected)).not.toContain(routing.baseUrl);
      expect(JSON.stringify(projected)).not.toContain(connected.grantId);
      expect(JSON.stringify(projected)).not.toContain("fixture-api-key");
      expect(JSON.stringify(projected)).not.toContain("must not be projected");
    }
  }, 90_000);
});
