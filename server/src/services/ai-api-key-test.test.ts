import { describe, expect, it, vi } from "vitest";
import { discoverAiGateway, validateAiApiKey } from "./ai-api-key-test.js";

const gateway = (auth: "api_key" | "bearer" = "api_key") => ({
  kind: "gateway" as const,
  protocol: "responses" as const,
  auth,
  baseUrl: "https://gateway.example/v1",
  models: [{ id: "gpt-test" }],
});

describe("validateAiApiKey custom gateways", () => {
  it.each([
    ["api_key", "api-key", "fixture-key"],
    ["bearer", "Authorization", "Bearer fixture-key"],
  ] as const)("uses the %s authentication header", async (auth, header, value) => {
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get(header)).toBe(value);
      return new Response(JSON.stringify({ data: [{ id: "gpt-test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await validateAiApiKey("openai", "fixture-key", request, gateway(auth));
    expect(request).toHaveBeenCalledWith(
      "https://gateway.example/v1/models",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    [401, "ai_connection_api_key_rejected"],
    [404, "ai_connection_base_url_invalid"],
    [429, "ai_connection_rate_limited"],
  ] as const)("classifies gateway status %s", async (status, code) => {
    const request = vi.fn(async () => new Response(null, { status }));
    await expect(validateAiApiKey("openai", "fixture-key", request, gateway())).rejects.toMatchObject({
      details: { code },
    });
  });

  it("rejects a configured model that the gateway does not advertise", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "other-model" }] }), { status: 200 }));
    await expect(validateAiApiKey("openai", "fixture-key", request, gateway())).rejects.toMatchObject({
      details: { code: "ai_connection_model_not_found" },
    });
  });
});

describe("discoverAiGateway", () => {
  it("returns models and detects supported protocols without sending a prompt", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ data: [{ id: "gpt-test", name: "Test model" }] }), { status: 200 });
    });
    await expect(discoverAiGateway("fixture-key", gateway(), request)).resolves.toEqual({
      models: [{ id: "gpt-test" }],
      protocols: { responses: true, chat: true },
    });
    expect(request).toHaveBeenCalledWith("https://gateway.example/v1/models", expect.objectContaining({ redirect: "error" }));
    expect(request).not.toHaveBeenCalledWith(expect.stringMatching(/responses|chat\/completions/), expect.objectContaining({ method: "POST" }));
  });

  it.each([
    [401, "ai_connection_api_key_rejected"],
    [403, "ai_connection_api_key_rejected"],
    [404, "ai_connection_models_unsupported"],
    [429, "ai_connection_rate_limited"],
  ] as const)("classifies /models status %s", async (status, code) => {
    const request = vi.fn(async () => new Response(null, { status }));
    await expect(discoverAiGateway("secret-value", gateway(), request)).rejects.toMatchObject({
      details: { code },
    });
  });

  it("does not expose the credential when discovery fails", async () => {
    const request = vi.fn(async () => new Response("upstream rejected secret-value", { status: 500 }));
    await expect(discoverAiGateway("secret-value", gateway(), request)).rejects.not.toThrow("secret-value");
  });

  it("rejects an empty model list without probing either protocol", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(discoverAiGateway("fixture-key", gateway(), request)).rejects.toMatchObject({
      details: { code: "ai_connection_models_unsupported" },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
