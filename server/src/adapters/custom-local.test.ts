import { describe, expect, it, vi } from "vitest";
import { executeCustom } from "./custom-local.js";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

function context(protocol: "responses" | "chat", auth: "api_key" | "bearer" | "none" = "api_key") {
  return {
    runId: "run-1",
    agent: {} as AdapterExecutionContext["agent"],
    runtime: {} as AdapterExecutionContext["runtime"],
    config: {
      model: "gpt-5.6-luna",
      maxOutputTokens: 128,
      env: { PAPERCLIP_AI_PROVIDER_KEY: "secret-value" },
      managedAiRouting: {
        kind: "gateway",
        protocol,
        baseUrl: "https://gateway.example/v1",
        auth,
        models: [{ id: "gpt-5.6-luna" }],
      },
    },
    context: { prompt: "hello" },
    onLog: vi.fn(async () => {}),
    onDispatch: vi.fn(),
  } as unknown as AdapterExecutionContext;
}

describe("custom HTTP adapter", () => {
  it("uses Responses schema and api-key authentication", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).not.toHaveProperty("max_tokens");
      expect(body.max_output_tokens).toBe(128);
      expect(init.headers).toMatchObject({ "api-key": "secret-value" });
      return new Response(JSON.stringify({ id: "resp-1", output: [{ content: [{ text: "done" }] }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeCustom(context("responses"));
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("done");
    expect(result.sessionParams).toEqual({ responseId: "resp-1" });
    vi.unstubAllGlobals();
  });

  it("uses Chat Completions only for chat routing", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://gateway.example/v1/chat/completions");
      expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 128 });
      expect(init.headers).toMatchObject({ authorization: "Bearer secret-value" });
      return new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeCustom(context("chat", "bearer"));
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("done");
    vi.unstubAllGlobals();
  });

  it("forwards provider-reported Responses cost without deriving a price from tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "resp-cost-1",
      output: [{ content: [{ text: "done" }] }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 80 },
        cost: "0.012345678",
      },
    }), { status: 200 })));

    const result = await executeCustom(context("responses"));

    expect(result).toMatchObject({
      exitCode: 0,
      usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, totalTokens: 120 },
      costUsd: 0.012345678,
      costUsdExact: "0.012345678",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "custom-openai-compatible/v1", evidence: "provider_cost" },
    });
    vi.unstubAllGlobals();
  });

  it("classifies a rejected provider request as safe to retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Unsupported parameter: 'max_tokens'" },
    }), { status: 400 })));

    const result = await executeCustom(context("chat"));

    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "custom_request_rejected",
      errorMessage: "Unsupported parameter: 'max_tokens'",
    });
    vi.unstubAllGlobals();
  });

  it("uses the resolved deployment model instead of the first catalog entry", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ model: "azure-deployment" });
      return new Response(JSON.stringify({ id: "resp-2", output: [{ content: [{ text: "done" }] }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeCustom({
      ...context("responses"),
      config: {
        ...context("responses").config,
        model: "",
        managedAiRouting: {
          kind: "gateway",
          protocol: "responses",
          baseUrl: "https://gateway.example/v1",
          auth: "api_key",
          models: [{ id: "gpt-5.6-luna" }],
        },
        managedAiConnection: {
          connectionId: "connection-1",
          grantId: "grant-1",
          deploymentId: "deployment-1",
          modelId: "azure-deployment",
          protocol: "responses",
          routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://gateway.example/v1", models: [] },
        },
      },
    } as AdapterExecutionContext);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("keeps legacy managed custom connections on the configured model path", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ model: "legacy-model" });
      return new Response(JSON.stringify({ id: "resp-3", output: [{ content: [{ text: "done" }] }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeCustom({
      ...context("responses"),
      config: {
        ...context("responses").config,
        model: "legacy-model",
        managedAiConnection: {
          connectionId: "connection-legacy",
          grantId: "grant-legacy",
          protocol: "responses",
          routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://gateway.example/v1", models: [] },
        },
      },
    } as AdapterExecutionContext);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("rejects a managed connection that has no resolved deployment model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeCustom({
      ...context("responses"),
      config: {
        ...context("responses").config,
        model: "",
        managedAiRouting: {
          kind: "gateway",
          protocol: "responses",
          baseUrl: "https://gateway.example/v1",
          auth: "api_key",
          models: [{ id: "gpt-5.6-luna" }],
        },
        managedAiConnection: {
          connectionId: "connection-1",
          grantId: "grant-1",
          deploymentId: "deployment-1",
          protocol: "responses",
          routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://gateway.example/v1", models: [] },
        },
      },
    } as AdapterExecutionContext);

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("custom_model_missing");
    expect(result.errorMessage).toContain("deployment model");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("captures LiteLLM spend from response header x-litellm-response-cost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "resp-header-1",
      output: [{ content: [{ text: "done" }] }],
      usage: {
        input_tokens: 50,
        output_tokens: 15,
      },
    }), {
      status: 200,
      headers: { "x-litellm-response-cost": "0.00345" },
    })));

    const result = await executeCustom(context("responses"));

    expect(result).toMatchObject({
      exitCode: 0,
      usage: { inputTokens: 50, outputTokens: 15, totalTokens: 65 },
      costUsd: 0.00345,
      costUsdExact: "0.00345",
      costStatus: "reported",
      pricingProvenance: {
        source: "provider_reported",
        version: "litellm-header/v1",
        evidence: "x-litellm-response-cost",
      },
    });
    vi.unstubAllGlobals();
  });

  it("queries POST /spend/calculate when response contains usage but no cost or spend", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://gateway.example/v1/responses") {
        return new Response(JSON.stringify({
          id: "resp-calc-1",
          output: [{ content: [{ text: "done" }] }],
          usage: {
            input_tokens: 80,
            output_tokens: 20,
          },
        }), { status: 200 });
      }
      if (url === "https://gateway.example/v1/spend/calculate") {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          model: "gpt-5.6-luna",
          prompt_tokens: 80,
          completion_tokens: 20,
        });
        expect(init?.headers).toMatchObject({ "api-key": "secret-value" });
        return new Response(JSON.stringify({ spend: "0.001234" }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCustom(context("responses"));

    expect(result).toMatchObject({
      exitCode: 0,
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
      costUsd: 0.001234,
      costUsdExact: "0.001234",
      costStatus: "reported",
      pricingProvenance: {
        source: "provider_reported",
        version: "litellm/spend-calculate",
        evidence: "https://gateway.example/v1/spend/calculate",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("safely falls back to unpriced when POST /spend/calculate returns 404", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://gateway.example/v1/responses") {
        return new Response(JSON.stringify({
          id: "resp-calc-404",
          output: [{ content: [{ text: "done" }] }],
          usage: {
            input_tokens: 80,
            output_tokens: 20,
          },
        }), { status: 200 });
      }
      if (url === "https://gateway.example/v1/spend/calculate") {
        return new Response("Not found", { status: 404 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeCustom(context("responses"));

    expect(result).toMatchObject({
      exitCode: 0,
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
    });
    expect(result).not.toHaveProperty("costUsd");
    expect(result).not.toHaveProperty("costUsdExact");
    expect(result).not.toHaveProperty("costStatus");
    expect(result).not.toHaveProperty("pricingProvenance");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
