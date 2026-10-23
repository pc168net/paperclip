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
    [403, "ai_connection_api_key_rejected"],
    [404, "ai_connection_base_url_invalid"],
    [429, "ai_connection_rate_limited"],
  ] as const)("classifies gateway status %s", async (status, code) => {
    const request = vi.fn(async () => new Response(null, { status }));
    await expect(validateAiApiKey("openai", "fixture-key", request, gateway())).rejects.toMatchObject({
      details: { code },
    });
  });

  it("does not reject an Azure-style deployment omitted from the /models catalog", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "other-model" }] }), { status: 200 }));
    await expect(validateAiApiKey("openai", "fixture-key", request, gateway())).resolves.toBeUndefined();
  });

  it("does not use Azure's global /models catalog when saving a connection", async () => {
    const request = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(validateAiApiKey("openai", "fixture-key", request, {
      ...gateway(),
      baseUrl: "https://twsoft-claw.openai.azure.com/openai/v1",
    })).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [{ models: [{ id: "gpt-test", label: "Test model" }] }, "object models"],
    [{ models: ["gpt-test"] }, "string models"],
  ] as const)("validates configured models from the %s envelope", async (body, _description) => {
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(validateAiApiKey("openai", "fixture-key", request, gateway())).resolves.toBeUndefined();
  });
});

describe("discoverAiGateway", () => {
  it.each([
    [{ data: [{ id: "gpt-test", name: "Test model" }] }, [{ id: "gpt-test" }]],
    [{ models: [{ id: "gpt-test", label: "Test model" }, "gpt-string"] }, [{ id: "gpt-test", label: "Test model" }, { id: "gpt-string" }]],
    [{ models: ["gpt-test"] }, [{ id: "gpt-test" }]],
  ] as const)("returns models from an OpenAI-compatible %s envelope", async (body, models) => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await expect(discoverAiGateway("fixture-key", gateway(), request)).resolves.toEqual({
      models,
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

  it.each([{ data: [] }, { models: [] }])("rejects an empty model list without probing either protocol", async (body) => {
    const request = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(discoverAiGateway("fixture-key", gateway(), request)).rejects.toMatchObject({
      details: { code: "ai_connection_models_unsupported" },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid model-list response without probing either protocol", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ object: "not-a-model-list" }), { status: 200 }));
    await expect(discoverAiGateway("fixture-key", gateway(), request)).rejects.toMatchObject({
      details: { code: "ai_connection_models_unsupported" },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("classifies a timeout without exposing the credential", async () => {
    const request = vi.fn(async () => { throw Object.assign(new Error("upstream timeout: secret-value"), { name: "TimeoutError" }); });
    await expect(discoverAiGateway("secret-value", gateway(), request)).rejects.toMatchObject({
      details: { code: "ai_connection_timeout" },
    });
    await expect(discoverAiGateway("secret-value", gateway(), request)).rejects.not.toThrow("secret-value");
  });
});
