import type { AiProvider, AiProviderRouting } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

/** Fixed provider endpoints; credentials are never sent to a caller-supplied URL or through a redirect. */
export async function validateAiApiKey(
  provider: AiProvider,
  key: string,
  request: typeof fetch = fetch,
  routing?: AiProviderRouting,
) {
  const endpoints = {
    anthropic: "https://api.anthropic.com/v1/models?limit=1",
    openai: "https://api.openai.com/v1/models",
    openrouter: "https://openrouter.ai/api/v1/key",
    xai: "https://api.x.ai/v1/models",
    google: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
  };
  const custom = routing?.kind === "gateway" || routing?.kind === "local";
  const endpoint = custom
    ? `${(routing.baseUrl ?? "").replace(/\/+$/, "")}/models`
    : endpoints[provider];
  let response: Response;
  try {
    response = await request(endpoint, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers:
        provider === "google" ? { "x-goog-api-key": key } : provider === "anthropic"
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : custom && routing?.auth === "api_key"
            ? { "api-key": key }
            : { Authorization: `Bearer ${key}` },
    });
  } catch {
    throw unprocessable(custom ? "Base URL is invalid or unreachable." : "Could not verify the account. Try again.", { code: custom ? "ai_connection_base_url_invalid" : "ai_connection_verification_failed" });
  }
  let advertisedModels: Set<string> | undefined;
  if (custom && routing?.models.length) {
    try {
      const payload = await response.clone().json() as { data?: Array<{ id?: string }> };
      advertisedModels = new Set((payload.data ?? []).flatMap((model) => model.id ? [model.id] : []));
    } catch {
      // A successful authentication response without a JSON model list is still
      // useful for gateways that intentionally hide model discovery.
    }
  }
  await response.body?.cancel();
  if (!response.ok)
    throw unprocessable(
      response.status === 401 || response.status === 403
        ? custom ? "API key is invalid for this endpoint." : "The provider rejected this API key."
        : response.status === 404
          ? "Base URL is invalid or does not expose an OpenAI-compatible /models endpoint."
          : response.status === 429
            ? "Rate limit reached. Try again later."
            : custom ? "The endpoint rejected the connection test." : "The provider could not verify this account. Try again.",
      { code: response.status === 401 || response.status === 403 ? "ai_connection_api_key_rejected" : response.status === 404 ? "ai_connection_base_url_invalid" : response.status === 429 ? "ai_connection_rate_limited" : "ai_connection_verification_failed" },
    );
  if (advertisedModels && routing?.models.some((model) => !advertisedModels!.has(model.id)))
    throw unprocessable("Model or deployment does not exist at this endpoint.", { code: "ai_connection_model_not_found" });
}
