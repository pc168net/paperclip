import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, aiDeployments, companies, companyMemberships, connectionGrants, toolConnections } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@paperclipai/db/test-embedded-postgres";
import { aiConnectionService } from "./ai-connections.js";
import { verifyAiDeployment, markAiDeploymentsStale, resolveVerifiedAiDeployment } from "./ai-deployments.js";

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

describe("verifyAiDeployment", () => {
  it("uses the stored credential in a real Responses deployment probe", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "response" }), { status: 200 });
    }) as typeof fetch;

    await expect(verifyAiDeployment(routing, "stored-secret", { modelId: "azure-deployment", protocol: "responses" }, request)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://example.test/v1/responses", init: { method: "POST", headers: { "api-key": "stored-secret" } } });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ model: "azure-deployment", input: "ping", max_output_tokens: 16 });
  });

  it("marks a rejected Chat deployment probe as failed without exposing provider output", async () => {
    const request = (async () => new Response("provider detail", { status: 404 })) as typeof fetch;

    await expect(verifyAiDeployment({ ...routing, auth: "bearer" }, "stored-secret", { modelId: "missing", protocol: "chat" }, request)).resolves.toEqual({ ok: false, error: "The deployment or API path was not found." });
  });

  it("uses the exact Chat probe body on success", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await expect(verifyAiDeployment({ ...routing, auth: "bearer" }, "stored-secret", { modelId: "chat-model", protocol: "chat" }, request)).resolves.toEqual({ ok: true });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ model: "chat-model", messages: [{ role: "user", content: "ping" }], max_tokens: 1 });
  });

  it("retries Azure v1 probes with bearer API-key authentication", async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const request = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init });
      return calls.length === 1 ? new Response(null, { status: 401 }) : new Response(null, { status: 200 });
    }) as typeof fetch;

    await expect(verifyAiDeployment({ ...routing, baseUrl: "https://resource.openai.azure.com/openai/v1" }, "stored-secret", { modelId: "azure-deployment", protocol: "chat" }, request)).resolves.toEqual({ ok: true });
    expect(new Headers(calls[0]?.init?.headers).get("api-key")).toBe("stored-secret");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer stored-secret");
  });

  it("classifies timeout and protocol failures without storing provider bodies", async () => {
    await expect(verifyAiDeployment(routing, "stored-secret", { modelId: "azure-deployment", protocol: "responses" }, (async () => { throw Object.assign(new Error("Timeout"), { name: "TimeoutError" }); }) as typeof fetch)).resolves.toEqual({ ok: false, error: "The verification probe timed out." });
    await expect(verifyAiDeployment(routing, "stored-secret", { modelId: "azure-deployment", protocol: "responses" }, (async () => { throw new TypeError("network protocol error"); }) as typeof fetch)).resolves.toEqual({ ok: false, error: "The endpoint could not be reached." });
  });

  it.each([
    { status: 401, error: "The stored credential was rejected." },
    { status: 403, error: "The stored credential was rejected." },
    { status: 404, error: "The deployment or API path was not found." },
  ] as const)("redacts provider bodies for HTTP $status responses", async ({ status, error }) => {
    const request = (async () => new Response("super-secret-provider-body", { status })) as typeof fetch;
    const result = await verifyAiDeployment({ ...routing, auth: "bearer" }, "stored-secret", { modelId: "azure-deployment", protocol: "responses" }, request);
    expect(result).toEqual({ ok: false, error });
    expect((result as { ok: false; error: string }).error).not.toContain("super-secret-provider-body");
  });
});

describeEmbeddedPostgres("deployment resolution and stale propagation", () => {
  it("marks only verified deployments stale for the touched connection and resolves current verified deployments", async () => {
    database = await startEmbeddedPostgresTestDatabase("paperclip-ai-deployments-service-");
    try {
      const db = createDb(database.connectionString);
      const companyId = randomUUID();
      const otherCompanyId = randomUUID();
      await db.insert(companies).values([{ id: companyId, name: "Paperclip", issuePrefix: "PCL" }, { id: otherCompanyId, name: "Other", issuePrefix: "OTH" }]);
      await db.insert(companyMemberships).values([{ companyId, principalId: "board", principalType: "user", status: "active", membershipRole: "member" }, { companyId: otherCompanyId, principalId: "board", principalType: "user", status: "active", membershipRole: "member" }]);
      const service = aiConnectionService(db);
      const created = await service.save(companyId, "board", { provider: "openai", method: "api_key", ownership: "shared", name: "AI", apiKey: "stored-secret", routing, agentIds: [], allAgents: true }, "stored-secret");
      const otherCreated = await service.save(otherCompanyId, "board", { provider: "openai", method: "api_key", ownership: "shared", name: "Other AI", apiKey: "stored-secret", routing, agentIds: [], allAgents: true }, "stored-secret");
      const [connection] = await db.select().from(toolConnections).where(eq(toolConnections.id, created.connectionId));
      const [otherConnection] = await db.select().from(toolConnections).where(eq(toolConnections.id, otherCreated.connectionId));
      const [primaryGrant] = await db.select().from(connectionGrants).where(eq(connectionGrants.id, created.grantId));
      const alternateGrantId = randomUUID();
      await db.insert(connectionGrants).values({
        id: alternateGrantId,
        companyId,
        connectionId: created.connectionId,
        kind: "organization",
        status: "active",
        providerTenant: primaryGrant?.providerTenant ?? {},
        credentialSecretRefs: primaryGrant?.credentialSecretRefs ?? [],
        createdByUserId: "board",
      });
      const verifiedId = randomUUID();
      const failedId = randomUUID();
      const otherId = randomUUID();
      await db.insert(aiDeployments).values([
        { id: verifiedId, companyId, connectionId: created.connectionId, modelId: "verified-model", displayName: "Verified", protocol: "responses", status: "verified", verifiedCredentialEpoch: connection!.credentialEpoch, createdByUserId: "board", verifiedAt: new Date(), lastError: null },
        { id: failedId, companyId, connectionId: created.connectionId, modelId: "failed-model", displayName: "Failed", protocol: "chat", status: "failed", verifiedCredentialEpoch: connection!.credentialEpoch, createdByUserId: "board", verifiedAt: null, lastError: "Provider rejected the verification probe." },
        { id: otherId, companyId: otherCompanyId, connectionId: otherCreated.connectionId, modelId: "other-model", displayName: "Other", protocol: "responses", status: "verified", verifiedCredentialEpoch: otherConnection!.credentialEpoch, createdByUserId: "board", verifiedAt: new Date(), lastError: null },
      ]);

      await markAiDeploymentsStale(db, companyId, created.connectionId, connection!.credentialEpoch);

      const [verified] = await db.select().from(aiDeployments).where(and(eq(aiDeployments.companyId, companyId), eq(aiDeployments.modelId, 'verified-model')));
      const [failed] = await db.select().from(aiDeployments).where(and(eq(aiDeployments.companyId, companyId), eq(aiDeployments.modelId, 'failed-model')));
      const [other] = await db.select().from(aiDeployments).where(and(eq(aiDeployments.companyId, otherCompanyId), eq(aiDeployments.modelId, 'other-model')));
      expect(verified?.status).toBe('stale');
      expect(verified?.lastError).toBeNull();
      expect(verified?.verifiedAt).toBeNull();
      expect(failed?.status).toBe('failed');
      expect(other?.status).toBe('verified');

      await expect(resolveVerifiedAiDeployment(db, { companyId, connectionId: created.connectionId, deploymentId: verified!.id })).rejects.toMatchObject({ status: 422, details: { code: 'ai_connection_deployment_missing', grantRequired: true } });

      const [fresh] = await db.insert(aiDeployments).values({ id: randomUUID(), companyId, connectionId: created.connectionId, modelId: "fresh-model", displayName: "Fresh", protocol: "responses", status: "verified", verifiedCredentialEpoch: connection!.credentialEpoch, createdByUserId: "board", verifiedAt: new Date(), lastError: null }).returning();
      const resolved = await resolveVerifiedAiDeployment(db, { companyId, connectionId: created.connectionId, deploymentId: fresh!.id, grantId: alternateGrantId });
      expect(resolved).toMatchObject({
        routing: expect.objectContaining({ kind: 'gateway', protocol: 'responses' }),
        deployment: expect.objectContaining({ id: fresh!.id, status: 'verified', verifiedCredentialEpoch: connection!.credentialEpoch }),
        grant: expect.objectContaining({ id: alternateGrantId }),
      });

      await expect(resolveVerifiedAiDeployment(db, { companyId, connectionId: created.connectionId, deploymentId: failed!.id, grantId: created.grantId })).rejects.toMatchObject({ status: 422, details: { code: 'ai_connection_deployment_missing' } });
    } finally {
      await database?.cleanup();
      database = undefined;
    }
  });
});
