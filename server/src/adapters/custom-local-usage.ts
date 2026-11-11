import type { AdapterExecutionResult, UsageSummary } from "@paperclipai/adapter-utils";
import { usdToUnits } from "@paperclipai/shared";

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

export function parseCost(value: unknown): { costUsd: number; costUsdExact: string } | undefined {
  let cost: { costUsd: number; costUsdExact: string } | undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    cost = { costUsd: value, costUsdExact: String(value) };
  } else if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) {
    const costUsd = Number(value);
    if (Number.isFinite(costUsd)) cost = { costUsd, costUsdExact: value };
  }
  if (!cost) return undefined;
  try {
    return usdToUnits(cost.costUsdExact) >= 0n ? cost : undefined;
  } catch {
    return undefined;
  }
}

export function parseSpendCalculateResponse(data: unknown): { costUsd: number; costUsdExact: string } | undefined {
  if (data == null) return undefined;
  if (typeof data === "number" || typeof data === "string") {
    return parseCost(data);
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const raw = obj.spend ?? obj.cost ?? obj.response_cost;
    return parseCost(raw);
  }
  return undefined;
}

export async function tryCalculateSpend(
  baseUrl: string,
  model: string,
  tokens: { prompt_tokens: number; completion_tokens: number },
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ costUsd: number; costUsdExact: string } | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/spend/calculate`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({
          model,
          prompt_tokens: tokens.prompt_tokens,
          completion_tokens: tokens.completion_tokens,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return parseSpendCalculateResponse(parsed);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    return undefined;
  }
}

export function parseCustomProviderUsage(
  body: Record<string, unknown>,
  headers?: Headers | Record<string, string | null | undefined>,
): CustomProviderUsageResult {
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

  const usageCost = usageRecord && Object.hasOwn(usageRecord, "cost") ? usageRecord.cost : undefined;
  const usageSpend = usageRecord && (Object.hasOwn(usageRecord, "spend") ? usageRecord.spend : Object.hasOwn(usageRecord, "response_cost") ? usageRecord.response_cost : undefined);
  const bodyCost = Object.hasOwn(body, "cost") ? body.cost : undefined;
  const bodySpend = Object.hasOwn(body, "spend") ? body.spend : Object.hasOwn(body, "response_cost") ? body.response_cost : undefined;

  let headerCost: string | undefined;
  if (headers) {
    if (typeof (headers as Headers).get === "function") {
      headerCost = (headers as Headers).get("x-litellm-response-cost") ?? undefined;
    } else {
      headerCost = (headers as Record<string, string | null | undefined>)["x-litellm-response-cost"] ?? undefined;
    }
  }

  let cost: { costUsd: number; costUsdExact: string } | undefined;
  let pricingProvenance: AdapterExecutionResult["pricingProvenance"];

  if (usageCost !== undefined || bodyCost !== undefined) {
    cost = parseCost(usageCost !== undefined ? usageCost : bodyCost);
    if (cost) {
      pricingProvenance = {
        source: "provider_reported",
        version: "custom-openai-compatible/v1",
        evidence: "provider_cost",
      };
    }
  }

  if (!cost && (usageSpend !== undefined || bodySpend !== undefined)) {
    cost = parseCost(usageSpend !== undefined ? usageSpend : bodySpend);
    if (cost) {
      pricingProvenance = {
        source: "provider_reported",
        version: "litellm-spend/v1",
        evidence: "litellm_spend",
      };
    }
  }

  if (!cost && headerCost !== undefined) {
    cost = parseCost(headerCost);
    if (cost) {
      pricingProvenance = {
        source: "provider_reported",
        version: "litellm-header/v1",
        evidence: "x-litellm-response-cost",
      };
    }
  }

  return {
    ...(usage ? { usage } : {}),
    ...(cost ? {
      ...cost,
      costStatus: "reported" as const,
      pricingProvenance,
    } : {}),
  };
}
