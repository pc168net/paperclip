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
});
