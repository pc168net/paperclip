import { describe, expect, it } from "vitest";
import { parseCustomProviderUsage, parseSpendCalculateResponse } from "./custom-local-usage.js";

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

  it("preserves LiteLLM usage.spend when cost is not present", () => {
    expect(parseCustomProviderUsage({
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        spend: "0.00456",
      },
    })).toEqual(expect.objectContaining({
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      costUsd: 0.00456,
      costUsdExact: "0.00456",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "litellm-spend/v1", evidence: "litellm_spend" },
    }));
  });

  it("preserves LiteLLM top-level spend when usage.spend is not present", () => {
    expect(parseCustomProviderUsage({
      spend: 0.003,
      usage: {
        prompt_tokens: 50,
        completion_tokens: 10,
      },
    })).toEqual(expect.objectContaining({
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
      costUsd: 0.003,
      costUsdExact: "0.003",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "litellm-spend/v1", evidence: "litellm_spend" },
    }));
  });

  it("extracts cost from x-litellm-response-cost header when response body has no cost or spend", () => {
    const headers = new Headers({ "x-litellm-response-cost": "0.00123" });
    expect(parseCustomProviderUsage({
      usage: { prompt_tokens: 40, completion_tokens: 10 },
    }, headers)).toEqual(expect.objectContaining({
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
      costUsd: 0.00123,
      costUsdExact: "0.00123",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "litellm-header/v1", evidence: "x-litellm-response-cost" },
    }));
  });

  it("prefers explicit cost over spend and headers", () => {
    const headers = new Headers({ "x-litellm-response-cost": "0.009" });
    expect(parseCustomProviderUsage({
      spend: 0.005,
      usage: {
        prompt_tokens: 40,
        completion_tokens: 10,
        cost: "0.002",
        spend: "0.003",
      },
    }, headers)).toEqual(expect.objectContaining({
      costUsd: 0.002,
      costUsdExact: "0.002",
      costStatus: "reported",
      pricingProvenance: { source: "provider_reported", version: "custom-openai-compatible/v1", evidence: "provider_cost" },
    }));
  });

  it.each([
    ["missing", undefined],
    ["negative number", -0.01],
    ["NaN string", "NaN"],
    ["infinite number", Infinity],
    ["malformed string", "0.1e2"],
    ["oversized number", 1_000_000_000_000_000],
    ["oversized string", "1000000000000000"],
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

  describe("parseSpendCalculateResponse", () => {
    it("parses a bare number response", () => {
      expect(parseSpendCalculateResponse(0.00123)).toEqual({
        costUsd: 0.00123,
        costUsdExact: "0.00123",
      });
    });

    it("parses an object with spend", () => {
      expect(parseSpendCalculateResponse({ spend: "0.0045" })).toEqual({
        costUsd: 0.0045,
        costUsdExact: "0.0045",
      });
    });

    it("parses an object with cost", () => {
      expect(parseSpendCalculateResponse({ cost: 0.0078 })).toEqual({
        costUsd: 0.0078,
        costUsdExact: "0.0078",
      });
    });

    it("returns undefined for invalid or negative spend responses", () => {
      expect(parseSpendCalculateResponse(null)).toBeUndefined();
      expect(parseSpendCalculateResponse({})).toBeUndefined();
      expect(parseSpendCalculateResponse(-0.01)).toBeUndefined();
      expect(parseSpendCalculateResponse({ spend: "invalid" })).toBeUndefined();
    });
  });
});
