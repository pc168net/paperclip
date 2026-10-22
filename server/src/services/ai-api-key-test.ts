import type { AiProvider, AiProviderRouting } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

export type AiGatewayDiscovery = {
  models: Array<{ id: string; label?: string }>;
  protocols: { responses: boolean; chat: boolean };
};

function gatewayHeaders(key: string, auth: AiProviderRouting["auth"]): HeadersInit {
  if (auth === "none") return {};
  return auth === "api_key" ? { "api-key": key } : { Authorization: `Bearer ${key}` };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || /timed?\s*out|timeout/i.test(error.message));
}

/** Read the two OpenAI-compatible model-list envelopes without trusting payload shape. */
function modelListFromPayload(payload: unknown): unknown[] | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = payload as { data?: unknown; models?: unknown };
  return Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : undefined;
}

function modelIdsFromPayload(payload: unknown): Set<string> | undefined {
  const rawModels = modelListFromPayload(payload);
  if (!rawModels) return undefined;
  return new Set(rawModels.flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
    if (typeof entry !== "object" || entry === null || typeof (entry as { id?: unknown }).id !== "string") return [];
    const id = (entry as { id: string }).id.trim();
    return id ? [id] : [];
  }));
}

/** Discover models and non-consuming protocol support for a custom gateway. */
export async function discoverAiGateway(
  key: string,
  routing: AiProviderRouting,
  request: typeof fetch = fetch,
): Promise<AiGatewayDiscovery> {
  if (routing.kind !== "gateway") throw unprocessable("Custom discovery requires a gateway endpoint.", { code: "ai_connection_base_url_invalid" });
  const baseUrl = (routing.baseUrl ?? "").replace(/\/+$/, "");
  let response: Response;
  try {
    response = await request(`${baseUrl}/models`, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: gatewayHeaders(key, routing.auth),
    });
  } catch (error) {
    throw unprocessable("Base URL is invalid or unreachable.", { code: isTimeout(error) ? "ai_connection_timeout" : "ai_connection_base_url_invalid" });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw unprocessable(
      response.status === 401 || response.status === 403
        ? "API key is invalid for this endpoint."
        : response.status === 404
          ? "This endpoint does not expose an OpenAI-compatible /models endpoint."
          : response.status === 429
            ? "Rate limit reached. Try again later."
            : "The endpoint rejected the connection test.",
      { code: response.status === 401 || response.status === 403 ? "ai_connection_api_key_rejected" : response.status === 404 ? "ai_connection_models_unsupported" : response.status === 429 ? "ai_connection_rate_limited" : "ai_connection_verification_failed" },
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw unprocessable("The endpoint returned an invalid /models response.", { code: "ai_connection_models_unsupported" });
  }
  const rawModels = modelListFromPayload(payload) ?? [];
  const models = rawModels.flatMap((entry) => {
    if (typeof entry === "string") return [{ id: entry }];
    if (typeof entry !== "object" || entry === null || typeof (entry as { id?: unknown }).id !== "string") return [];
    const id = (entry as { id: string }).id.trim();
    return id ? [{ id, ...((entry as { label?: unknown }).label && typeof (entry as { label: string }).label === "string" ? { label: (entry as { label: string }).label } : {}) }] : [];
  });
  if (!models.length) throw unprocessable("The endpoint did not advertise any models.", { code: "ai_connection_models_unsupported" });

  const protocolSupported = async (path: string) => {
    try {
      const probe = await request(`${baseUrl}/${path}`, {
        method: "OPTIONS",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: gatewayHeaders(key, routing.auth),
      });
      await probe.body?.cancel();
      return probe.status >= 200 && probe.status < 300;
    } catch {
      return false;
    }
  };
  const [responses, chat] = await Promise.all([protocolSupported("responses"), protocolSupported("chat/completions")]);
  return { models, protocols: { responses, chat } };
}

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
  } catch (error) {
    throw unprocessable(custom ? "Base URL is invalid or unreachable." : "Could not verify the account. Try again.", { code: custom ? isTimeout(error) ? "ai_connection_timeout" : "ai_connection_base_url_invalid" : "ai_connection_verification_failed" });
  }
  let advertisedModels: Set<string> | undefined;
  if (custom && routing?.models.length) {
    try {
      // Preserve validation's existing behavior for a JSON response that does
      // not contain a model list: configured models are not considered advertised.
      advertisedModels = modelIdsFromPayload(await response.clone().json()) ?? new Set();
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
