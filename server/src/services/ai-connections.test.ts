import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, aiDeployments, companies, companyMemberships, connectionGrants, toolConnections } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { aiConnectionService } from "./ai-connections.js";
import { prepareManagedAiRuntime } from "./ai-connection-runtime.js";

const routing = {
  kind: "gateway" as const,
  protocol: "responses" as const,
  auth: "api_key" as const,
  baseUrl: "https://example.test/v1/",
  models: [],
};

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;

afterAll(async () => {
  await database?.cleanup();
});

describeEmbeddedPostgres("managed AI deployment resolution", () => {
  it("resolves a verified deployment for a custom managed binding", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-connections-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "PCL" });
      await db.insert(companyMemberships).values({ companyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" });
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Managed custom",
        apiKey: "stored-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "stored-secret");
      const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, created.connectionId));
      const verifiedDeploymentId = randomUUID();
      await db.insert(aiDeployments).values({
        id: verifiedDeploymentId,
        companyId,
        connectionId: created.connectionId,
        modelId: "azure-deployment",
        displayName: "Azure deployment",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: connection!.credentialEpoch,
        createdByUserId: "alice",
        verifiedAt: new Date(),
        lastError: null,
      });

      const resolved = await service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: {
          mode: "shared",
          provider: "openai",
          method: "api_key",
          connectionId: created.connectionId,
          grantId: created.grantId,
          deploymentId: verifiedDeploymentId,
        },
      });

      expect(resolved.deployment).toMatchObject({
        id: verifiedDeploymentId,
        modelId: "azure-deployment",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: connection!.credentialEpoch,
      });
      expect(resolved.attribution).toMatchObject({
        connectionId: created.connectionId,
        grantId: created.grantId,
        deploymentId: verifiedDeploymentId,
        modelId: "azure-deployment",
        protocol: "responses",
      });
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });

  it("rejects stale, failed, cross-company, missing-grant, disabled, and epoch-mismatched deployments", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-connections-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      const otherCompanyId = randomUUID();
      await db.insert(companies).values([
        { id: companyId, name: "Paperclip", issuePrefix: "PCL" },
        { id: otherCompanyId, name: "Other", issuePrefix: "OTH" },
      ]);
      await db.insert(companyMemberships).values([
        { companyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" },
        { companyId: otherCompanyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" },
      ]);
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Managed custom",
        apiKey: "stored-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "stored-secret");
      const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, created.connectionId));
      const [otherConnection] = await db.select().from(toolConnections).where(eq(toolConnections.id, (await service.save(otherCompanyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Other managed custom",
        apiKey: "other-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "other-secret")).connectionId));

      const staleDeploymentId = randomUUID();
      const failedDeploymentId = randomUUID();
      const verifiedDeploymentId = randomUUID();
      const crossCompanyDeploymentId = randomUUID();
      await db.insert(aiDeployments).values([
        { id: staleDeploymentId, companyId, connectionId: created.connectionId, modelId: "stale-model", displayName: "Stale", protocol: "responses", status: "stale", verifiedCredentialEpoch: connection!.credentialEpoch, createdByUserId: "alice", verifiedAt: null, lastError: null },
        { id: failedDeploymentId, companyId, connectionId: created.connectionId, modelId: "failed-model", displayName: "Failed", protocol: "responses", status: "failed", verifiedCredentialEpoch: connection!.credentialEpoch, createdByUserId: "alice", verifiedAt: null, lastError: "Provider rejected the verification probe." },
        { id: verifiedDeploymentId, companyId, connectionId: created.connectionId, modelId: "verified-model", displayName: "Verified", protocol: "responses", status: "verified", verifiedCredentialEpoch: connection!.credentialEpoch, createdByUserId: "alice", verifiedAt: new Date(), lastError: null },
        { id: crossCompanyDeploymentId, companyId: otherCompanyId, connectionId: otherConnection!.id, modelId: "other-model", displayName: "Other", protocol: "responses", status: "verified", verifiedCredentialEpoch: otherConnection!.credentialEpoch, createdByUserId: "alice", verifiedAt: new Date(), lastError: null },
      ]);

      await expect(service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: created.grantId, deploymentId: staleDeploymentId },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_deployment_missing" } });

      await expect(service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: created.grantId, deploymentId: failedDeploymentId },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_deployment_missing" } });

      await expect(service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: created.grantId, deploymentId: crossCompanyDeploymentId },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_deployment_missing" } });

      await expect(service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: randomUUID(), deploymentId: verifiedDeploymentId },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_missing" } });

      await db.update(toolConnections).set({ enabled: false }).where(eq(toolConnections.id, created.connectionId));
      await expect(service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: created.grantId, deploymentId: verifiedDeploymentId },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_unavailable" } });

      await db.update(toolConnections).set({ enabled: true, credentialEpoch: connection!.credentialEpoch + 1 }).where(eq(toolConnections.id, created.connectionId));
      await expect(service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: created.grantId, deploymentId: verifiedDeploymentId },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_deployment_missing" } });
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });

  it("keeps legacy bindings on the non-deployment path", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-connections-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "PCL" });
      await db.insert(companyMemberships).values({ companyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" });
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Legacy custom",
        apiKey: "stored-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "stored-secret");
      const selection = await service.select({
        companyId,
        agentId: randomUUID(),
        userId: "alice",
        adapterType: "custom_local",
        binding: { mode: "shared", provider: "openai", method: "api_key", connectionId: created.connectionId, grantId: created.grantId },
      });

      expect(selection.deployment).toBeUndefined();
      expect(selection.attribution).toMatchObject({
        connectionId: created.connectionId,
        grantId: created.grantId,
      });
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });

  it("passes a resolved deployment model through managed runtime preparation", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-connections-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "PCL" });
      await db.insert(companyMemberships).values({ companyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" });
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Managed custom",
        apiKey: "stored-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "stored-secret");
      const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, created.connectionId));
      const deploymentId = randomUUID();
      await db.insert(aiDeployments).values({
        id: deploymentId,
        companyId,
        connectionId: created.connectionId,
        modelId: "azure-deployment",
        displayName: "Azure deployment",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: connection!.credentialEpoch,
        createdByUserId: "alice",
        verifiedAt: new Date(),
        lastError: null,
      });

      const runtime = await prepareManagedAiRuntime(db, {
        companyId,
        agentId: randomUUID(),
        responsibleUserId: "alice",
        adapterType: "custom_local",
        binding: {
          mode: "shared",
          provider: "openai",
          method: "api_key",
          connectionId: created.connectionId,
          grantId: created.grantId,
          deploymentId,
        },
        config: {
          model: "gpt-5.6-luna",
          provider: "custom",
          managedAiRouting: routing,
          env: { PAPERCLIP_AI_PROVIDER_KEY: "stored-secret" },
        },
      });

      expect(runtime.attribution).toMatchObject({
        connectionId: created.connectionId,
        grantId: created.grantId,
        deploymentId,
        modelId: "azure-deployment",
        protocol: "responses",
      });
      expect(runtime.config).toMatchObject({
        model: "azure-deployment",
        managedAiConnection: expect.objectContaining({ deploymentId, modelId: "azure-deployment", protocol: "responses" }),
      });
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });

  it("preserves the configured model for a legacy managed binding without deployment metadata", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-connections-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "PCL" });
      await db.insert(companyMemberships).values({ companyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" });
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Managed custom",
        apiKey: "stored-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "stored-secret");

      const runtime = await prepareManagedAiRuntime(db, {
        companyId,
        agentId: randomUUID(),
        responsibleUserId: "alice",
        adapterType: "custom_local",
        binding: {
          mode: "shared",
          provider: "openai",
          method: "api_key",
          connectionId: created.connectionId,
          grantId: created.grantId,
        },
        config: {
          model: "legacy-model",
          provider: "custom",
          managedAiRouting: routing,
          env: { PAPERCLIP_AI_PROVIDER_KEY: "stored-secret" },
        },
      });

      expect(runtime.config).toMatchObject({
        model: "legacy-model",
        managedAiConnection: expect.not.objectContaining({ deploymentId: expect.any(String) }),
      });
      expect(runtime.attribution).not.toHaveProperty("deploymentId");
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });

  it("rejects execution after the selected deployment is deleted", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-connections-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Paperclip", issuePrefix: "PCL" });
      await db.insert(companyMemberships).values({ companyId, principalId: "alice", principalType: "user", status: "active", membershipRole: "member" });
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "alice", {
        provider: "openai",
        method: "api_key",
        ownership: "shared",
        name: "Managed custom",
        apiKey: "stored-secret",
        routing,
        agentIds: [],
        allAgents: true,
      }, "stored-secret");
      const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, created.connectionId));
      const deploymentId = randomUUID();
      await db.insert(aiDeployments).values({
        id: deploymentId,
        companyId,
        connectionId: created.connectionId,
        modelId: "azure-deployment",
        displayName: "Azure deployment",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: connection!.credentialEpoch,
        createdByUserId: "alice",
        verifiedAt: new Date(),
        lastError: null,
      });
      await db.delete(aiDeployments).where(eq(aiDeployments.id, deploymentId));

      await expect(prepareManagedAiRuntime(db, {
        companyId,
        agentId: randomUUID(),
        responsibleUserId: "alice",
        adapterType: "custom_local",
        binding: {
          mode: "shared",
          provider: "openai",
          method: "api_key",
          connectionId: created.connectionId,
          grantId: created.grantId,
          deploymentId,
        },
        config: {
          model: "gpt-5.6-luna",
          provider: "custom",
          managedAiRouting: routing,
          env: { PAPERCLIP_AI_PROVIDER_KEY: "stored-secret" },
        },
      })).rejects.toMatchObject({ status: 422, details: { code: "ai_connection_deployment_missing" } });
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });
});
