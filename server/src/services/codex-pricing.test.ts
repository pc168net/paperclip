import { describe, expect, it } from "vitest";
import type { AdapterUsageCheckpoint } from "@paperclipai/adapter-utils";
import { priceCodexReceipt } from "./codex-pricing.js";

const receipt: AdapterUsageCheckpoint = {
  complete: true,
  usageBasis: "per_run",
  provider: "openai",
  biller: "openai",
  billingType: "metered_api",
  model: "gpt-6-sol",
  costUsd: null,
  costStatus: "unpriced",
  usage: {
    inputTokens: 1000,
    cachedInputTokens: 200,
    outputTokens: 500,
  },
};

describe("priceCodexReceipt", () => {
  it("prices complete OpenAI direct receipts and labels provenance as an estimate", () => {
    const priced = priceCodexReceipt(receipt);
    expect(priced.costStatus).toBe("estimated");
    expect(Number(priced.costUsdExact)).toBeGreaterThan(0);
    expect(priced.pricingProvenance).toMatchObject({
      source: "rate_card",
      version: "openai-standard-2026-09-30",
    });
  });

  it("prices gpt-5.6-terra with the verified rate card", () => {
    const terraReceipt: AdapterUsageCheckpoint = {
      ...receipt,
      model: "gpt-5.6-terra",
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 0,
        outputTokens: 1_000,
      },
    };
    const priced = priceCodexReceipt(terraReceipt);
    expect(priced.costStatus).toBe("estimated");
    // input: 10k * $2/M = $0.02; output: 1k * $10/M = $0.01; total = $0.03
    expect(Number(priced.costUsdExact)).toBeCloseTo(0.03, 3);
  });

  it("prices gpt-5.6-luna with the verified rate card", () => {
    const lunaReceipt: AdapterUsageCheckpoint = {
      ...receipt,
      model: "gpt-5.6-luna",
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 0,
        outputTokens: 1_000,
      },
    };
    const priced = priceCodexReceipt(lunaReceipt);
    expect(priced.costStatus).toBe("estimated");
    expect(Number(priced.costUsdExact)).toBeGreaterThan(0);
  });

  it("prices gateway / Azure OpenAI runs where biller is unknown or custom", () => {
    const azureReceipt: AdapterUsageCheckpoint = {
      ...receipt,
      biller: "unknown",
      model: "gpt-5.6-terra",
    };
    const priced = priceCodexReceipt(azureReceipt);
    expect(priced.costStatus).toBe("estimated");
    expect(Number(priced.costUsdExact)).toBeGreaterThan(0);
  });

  it("prices when provider is codex", () => {
    const codexProviderReceipt: AdapterUsageCheckpoint = {
      ...receipt,
      provider: "codex",
      biller: "unknown",
      model: "gpt-5.6-terra",
    };
    const priced = priceCodexReceipt(codexProviderReceipt);
    expect(priced.costStatus).toBe("estimated");
    expect(Number(priced.costUsdExact)).toBeGreaterThan(0);
  });

  it.each([
    { complete: false },
    { billingType: "unknown" as const },
    { billingType: "subscription_included" as const },
    { provider: "anthropic" },
    { model: "unsupported-model-xyz" },
    { usageBasis: "session_cumulative" as const },
    { costUsd: 0.12 },
    { costUsdExact: "0.12" },
    { usage: undefined },
    { usage: { inputTokens: -1, outputTokens: 1 } },
  ] as Partial<AdapterUsageCheckpoint>[])("preserves incomplete, unbillable or already priced receipts: %j", (override) => {
    const original = { ...receipt, ...override };
    expect(priceCodexReceipt(original)).toBe(original);
  });
});
