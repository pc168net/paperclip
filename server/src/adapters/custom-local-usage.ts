import type { AdapterExecutionResult, UsageSummary } from "@paperclipai/adapter-utils";

type CustomProviderUsage = UsageSummary & { totalTokens: number };

export type CustomProviderUsageResult = {
  usage?: CustomProviderUsage;
  costUsd?: number;
  costUsdExact?: string;
  costStatus?: "reported" | "unpriced";
  pricingProvenance?: AdapterExecutionResult["pricingProvenance"];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function parseCost(value: unknown): { costUsd: number; costUsdExact: string } | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { costUsd: value, costUsdExact: String(value) };
  }
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const costUsd = Number(value);
  return Number.isFinite(costUsd) ? { costUsd, costUsdExact: value } : undefined;
}

export function parseCustomProviderUsage(body: Record<string, unknown>): CustomProviderUsageResult {
  const usageRecord = record(body.usage);
  const input = Number(usageRecord?.input_tokens ?? usageRecord?.prompt_tokens ?? 0);
  const output = Number(usageRecord?.output_tokens ?? usageRecord?.completion_tokens ?? 0);
  const details = record(usageRecord?.input_tokens_details ?? usageRecord?.prompt_tokens_details);
  const cachedInput = Number(details?.cached_tokens ?? 0);
  const usage = usageRecord && Number.isFinite(input) && Number.isFinite(output) && Number.isFinite(cachedInput)
    ? {
      inputTokens: input,
      ...(details?.cached_tokens === undefined ? {} : { cachedInputTokens: cachedInput }),
      outputTokens: output,
      totalTokens: input + output,
    }
    : undefined;
  const rawCost = usageRecord && Object.hasOwn(usageRecord, "cost") ? usageRecord.cost : body.cost;
  const cost = parseCost(rawCost);

  return {
    ...(usage ? { usage } : {}),
    ...(cost ? {
      ...cost,
      costStatus: "reported" as const,
      pricingProvenance: {
        source: "provider_reported" as const,
        version: "custom-openai-compatible/v1",
        evidence: "provider_cost",
      },
    } : {}),
  };
}
