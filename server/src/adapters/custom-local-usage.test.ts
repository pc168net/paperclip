import { describe, expect, it } from "vitest";
import { parseCustomProviderUsage } from "./custom-local-usage.js";

describe("parseCustomProviderUsage", () => {
  it("preserves Responses token usage and a provider-reported decimal cost", () => {
    expect(parseCustomProviderUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 80 },
        cost: "0.012345678",
      },
    })).toEqual(expect.objectContaining({
      usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, totalTokens: 120 },
      costUsd: 0.012345678,
      costUsdExact: "0.012345678",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "custom-openai-compatible/v1", evidence: "provider_cost" },
    }));
  });

  it("normalizes Chat Completions usage and lets usage cost override top-level cost", () => {
    expect(parseCustomProviderUsage({
      cost: "1.5",
      usage: {
        prompt_tokens: 60,
        completion_tokens: 15,
        prompt_tokens_details: { cached_tokens: 40 },
        cost: "0.005",
      },
    })).toEqual(expect.objectContaining({
      usage: { inputTokens: 60, cachedInputTokens: 40, outputTokens: 15, totalTokens: 75 },
      costUsd: 0.005,
      costUsdExact: "0.005",
      costStatus: "reported",
    }));
  });

  it("reports an explicit zero top-level cost", () => {
    expect(parseCustomProviderUsage({
      cost: 0,
      usage: { input_tokens: 1, output_tokens: 2 },
    })).toEqual(expect.objectContaining({
      costUsd: 0,
      costUsdExact: "0",
      costStatus: "reported",
    }));
  });

  it("does not synthesize usage when the provider omits a usage object", () => {
    expect(parseCustomProviderUsage({ cost: "0.01" })).toEqual({
      costUsd: 0.01,
      costUsdExact: "0.01",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "custom-openai-compatible/v1", evidence: "provider_cost" },
    });
  });

  it.each([
    ["missing", undefined],
    ["negative number", -0.01],
    ["NaN string", "NaN"],
    ["infinite number", Infinity],
    ["malformed string", "0.1e2"],
  ])("preserves usage without cost fields when cost is %s", (_description, cost) => {
    const result = parseCustomProviderUsage({
      ...(cost === undefined ? {} : { cost }),
      usage: { input_tokens: 7, output_tokens: 3 },
    });

    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3, totalTokens: 10 });
    expect(result).not.toHaveProperty("costUsd");
    expect(result).not.toHaveProperty("costUsdExact");
    expect(result).not.toHaveProperty("costStatus");
    expect(result).not.toHaveProperty("pricingProvenance");
  });
});
