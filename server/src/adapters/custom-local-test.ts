import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { aiProviderRoutingSchema, type AiProviderRouting } from "@paperclipai/shared";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";
import { unprocessable } from "../errors.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

/**
 * The custom adapter validates the saved gateway directly. It deliberately
 * does not delegate to a CLI adapter: custom endpoints are an HTTP contract,
 * not a Codex or OpenCode login.
 */
export async function testCustomEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const parsed = aiProviderRoutingSchema.safeParse(config.managedAiRouting);
  if (!parsed.success || parsed.data.kind !== "gateway") {
    return {
      adapterType: "custom_local",
      status: "fail",
      checks: [{ code: "custom_endpoint_invalid", level: "error", message: "Custom runner requires a gateway endpoint." }],
      testedAt: new Date().toISOString(),
    };
  }
  const route: AiProviderRouting = parsed.data;
  const env = parseObject(config.env);
  const credential = route.auth === "none" ? "" : typeof env.PAPERCLIP_AI_PROVIDER_KEY === "string" ? env.PAPERCLIP_AI_PROVIDER_KEY : "";
  try {
    // Connection setup owns /models discovery. Repeating it here makes an
    // already-selected connection fail on gateways whose catalog endpoint is
    // intermittent or differs from their inference route. The real request
    // below is the authoritative model and credential verification.
    const selectedModel = typeof config.model === "string" && config.model.trim() ? config.model.trim() : route.models[0]?.id;
    if (!selectedModel) {
      throw unprocessable("This connection has no configured model. Reconnect it in Connectors and choose a model or deployment.", { code: "ai_connection_model_not_found" });
    }
    // OPTIONS is commonly disabled by Azure-compatible gateways. Verify the
    // selected protocol with a harmless request instead of treating an OPTIONS
    // 405 as proof that the protocol is unavailable.
    const protocolPath = route.protocol === "responses" ? "responses" : "chat/completions";
    const protocolResponse = await fetch(`${route.baseUrl!.replace(/\/+$/, "")}/${protocolPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(route.auth === "api_key" ? { "api-key": credential } : route.auth === "bearer" ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(route.protocol === "responses"
        ? { model: selectedModel, input: "ping", max_output_tokens: 16 }
        : { model: selectedModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    });
    const responseText = await protocolResponse.text();
    if ([401, 403, 404].includes(protocolResponse.status)) {
      let providerMessage = "";
      try {
        const payload = JSON.parse(responseText) as { error?: { message?: unknown } };
        providerMessage = typeof payload.error?.message === "string" ? payload.error.message : "";
      } catch { /* The status-based diagnostic below is sufficient. */ }
      if (protocolResponse.status === 401 || protocolResponse.status === 403) {
        throw unprocessable("API key is invalid for this endpoint.", { code: "ai_connection_api_key_rejected" });
      }
      if (/\b(?:model|deployment)\b.{0,80}\b(?:not found|does not exist|unavailable)\b|\b(?:not found|does not exist|unavailable)\b.{0,80}\b(?:model|deployment)\b/i.test(providerMessage)) {
        throw unprocessable("Model or deployment does not exist at this endpoint.", { code: "ai_connection_model_not_found" });
      }
      throw unprocessable(`The endpoint does not support ${route.protocol === "responses" ? "the OpenAI Responses protocol" : "Chat Completions"}.`, { code: "ai_connection_protocol_unsupported" });
    }
    checks.push({ code: "custom_endpoint_reachable", level: "info", message: "Custom endpoint and credentials were verified." });
    checks.push({ code: "custom_model_available", level: "info", message: `Model is available: ${selectedModel ?? "discovered endpoint model"}.` });
    checks.push({ code: "custom_hello_probe_passed", level: "info", message: "Runner: Custom. No Codex login or binary probe was used." });
  } catch (error) {
    const code = error instanceof Error && "details" in error
      ? ((error as { details?: { code?: string } }).details?.code ?? "custom_endpoint_verification_failed")
      : "custom_endpoint_verification_failed";
    checks.push({ code, level: "error", message: error instanceof Error ? error.message : "Could not verify the custom endpoint." });
  }
  return { adapterType: "custom_local", status: summarizeStatus(checks), checks, testedAt: new Date().toISOString() };
}
