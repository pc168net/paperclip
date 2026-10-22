import { and, eq } from "drizzle-orm";
import { aiDeployments, connectionGrants, toolConnections, type Db } from "@paperclipai/db";
import { aiConnectionMetadataSchema, type AiDeploymentProtocol, type AiProviderRouting } from "@paperclipai/shared";
import { aiConnectionConfigurationFailure } from "./ai-connection-configuration-failure.js";

function headers(credential: string, auth: AiProviderRouting["auth"]): HeadersInit {
  if (auth === "none") return { "content-type": "application/json" };
  return {
    "content-type": "application/json",
    ...(auth === "api_key" ? { "api-key": credential } : { Authorization: `Bearer ${credential}` }),
  };
}

function messageForStatus(status: number) {
  if (status === 401 || status === 403) return "The stored credential was rejected.";
  if (status === 404) return "The deployment or API path was not found.";
  if (status === 429) return "The provider rate-limited the verification probe.";
  return "The provider rejected the verification probe.";
}

function configFailure(details: Record<string, unknown>) {
  return aiConnectionConfigurationFailure("ai_connection_deployment_missing", "The selected deployment is not verified", details);
}

/**
 * Verify the selected deployment, rather than treating a /models catalog as
 * proof. The deliberately tiny non-streaming request exercises the exact
 * model/deployment and protocol that an agent will use.
 */
export async function verifyAiDeployment(
  routing: AiProviderRouting,
  credential: string,
  deployment: { modelId: string; protocol: AiDeploymentProtocol },
  request: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseUrl = (routing.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl || routing.kind === "bedrock") return { ok: false, error: "This connection does not expose a deployable HTTP endpoint." };
  const path = deployment.protocol === "responses" ? "responses" : "chat/completions";
  const body = deployment.protocol === "responses"
    ? { model: deployment.modelId, input: "ping", max_output_tokens: 16 }
    : { model: deployment.modelId, messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  let response: Response;
  try {
    response = await request(`${baseUrl}/${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: headers(credential, routing.auth),
      body: JSON.stringify(body),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || /timed?\s*out|timeout/i.test(error.message));
    return { ok: false, error: timedOut ? "The verification probe timed out." : "The endpoint could not be reached." };
  }
  await response.body?.cancel();
  return response.ok ? { ok: true } : { ok: false, error: messageForStatus(response.status) };
}

export async function markAiDeploymentsStale(db: Db, companyId: string, connectionId: string, previousEpoch?: number): Promise<void> {
  const conditions = [
    eq(aiDeployments.companyId, companyId),
    eq(aiDeployments.connectionId, connectionId),
    eq(aiDeployments.status, "verified"),
  ];
  if (previousEpoch !== undefined) conditions.push(eq(aiDeployments.verifiedCredentialEpoch, previousEpoch));
  await db.update(aiDeployments).set({ status: "stale", lastError: null, verifiedAt: null, updatedAt: new Date() }).where(and(...conditions));
}

export async function resolveVerifiedAiDeployment(
  db: Db,
  input: { companyId: string; deploymentId: string; connectionId: string; grantId?: string },
  options: { requireVerified?: boolean } = {},
): Promise<{
  deployment: typeof aiDeployments.$inferSelect;
  connection: typeof toolConnections.$inferSelect;
  grant: typeof connectionGrants.$inferSelect;
  routing: AiProviderRouting;
}> {
  if (!input.grantId) {
    throw configFailure({ companyId: input.companyId, connectionId: input.connectionId, deploymentId: input.deploymentId, grantId: null, grantRequired: true });
  }
  const [row] = await db
    .select({ deployment: aiDeployments, connection: toolConnections, grant: connectionGrants })
    .from(aiDeployments)
    .innerJoin(toolConnections, and(eq(toolConnections.companyId, aiDeployments.companyId), eq(toolConnections.id, aiDeployments.connectionId)))
    .innerJoin(connectionGrants, and(eq(connectionGrants.companyId, toolConnections.companyId), eq(connectionGrants.connectionId, toolConnections.id), eq(connectionGrants.id, input.grantId)))
    .where(and(
      eq(aiDeployments.companyId, input.companyId),
      eq(aiDeployments.id, input.deploymentId),
      eq(aiDeployments.connectionId, input.connectionId),
      eq(toolConnections.connectionPurpose, "ai"),
      eq(toolConnections.status, "active"),
      eq(toolConnections.enabled, true),
      eq(connectionGrants.status, "active"),
    ))
    .limit(1);

  if (!row) throw configFailure({ companyId: input.companyId, connectionId: input.connectionId, deploymentId: input.deploymentId, grantId: input.grantId });

  const metadata = aiConnectionMetadataSchema.safeParse(row.connection.config.ai);
  if (!metadata.success || !metadata.data.routing || !["gateway", "local"].includes(metadata.data.routing.kind)) {
    throw configFailure({ companyId: input.companyId, connectionId: input.connectionId, deploymentId: input.deploymentId, grantId: input.grantId });
  }
  if (options.requireVerified !== false && (row.deployment.status !== "verified" || row.deployment.verifiedCredentialEpoch !== row.connection.credentialEpoch)) {
    throw configFailure({ companyId: input.companyId, connectionId: input.connectionId, deploymentId: input.deploymentId, grantId: input.grantId, verifiedCredentialEpoch: row.deployment.verifiedCredentialEpoch, currentCredentialEpoch: row.connection.credentialEpoch });
  }
  return { deployment: row.deployment, connection: row.connection, grant: row.grant, routing: metadata.data.routing };
}
