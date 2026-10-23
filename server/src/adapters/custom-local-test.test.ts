import { afterEach, describe, expect, it, vi } from "vitest";
import { testCustomEnvironment } from "./custom-local-test.js";

const context = (overrides: Record<string, unknown> = {}) => ({
  companyId: "company-1",
  adapterType: "custom_local",
  config: {
    model: "gpt-custom",
    managedAiRouting: {
      kind: "gateway",
      protocol: "responses",
      baseUrl: "https://gateway.example/v1",
      auth: "api_key",
      models: [{ id: "gpt-custom" }],
    },
    env: { PAPERCLIP_AI_PROVIDER_KEY: "fixture-key" },
    ...overrides,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe("custom_local environment diagnostics", () => {
  it("verifies the gateway without invoking a CLI", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return Response.json({ data: [{ id: "gpt-custom" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testCustomEnvironment(context());

    expect(result.status).toBe("pass");
    expect(result.checks.some((check) => check.code === "custom_hello_probe_passed")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unsupported protocol instead of a Codex auth error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
       if (init?.method === "OPTIONS") return new Response(null, { status: 405 });
       if (init?.method === "POST") return new Response(null, { status: 404 });
      return Response.json({ data: [{ id: "gpt-custom" }] });
    }));

    const result = await testCustomEnvironment(context());

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.code === "ai_connection_protocol_unsupported")?.message).toContain("Responses");
    expect(result.checks.some((check) => /Codex/i.test(check.message))).toBe(false);
  });

  it("reports an Azure deployment 404 as a model failure rather than a protocol failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      if (init?.method === "POST") return Response.json({ error: { message: "The API deployment for this model does not exist." } }, { status: 404 });
      return Response.json({ data: [{ id: "gpt-custom" }] });
    }));

    const result = await testCustomEnvironment(context());

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.code === "ai_connection_model_not_found")?.message).toContain("Model or deployment");
  });

  it("does not pass an endpoint that has no configured model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "gpt-custom" }] })));
    const result = await testCustomEnvironment(context({ model: "", managedAiRouting: {
      kind: "gateway", protocol: "responses", baseUrl: "https://gateway.example/v1", auth: "api_key", models: [],
    } }));

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.code === "ai_connection_model_not_found")?.message).toContain("no configured model");
  });
});
