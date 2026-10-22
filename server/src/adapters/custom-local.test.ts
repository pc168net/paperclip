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
});
