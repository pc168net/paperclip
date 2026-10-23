import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { executeCustom } from "../adapters/custom-local.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { accountRunCost } from "../services/run-cost-accounting.js";
import { costService } from "../services/costs.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function customContext(): AdapterExecutionContext {
  return {
    runId: "custom-provider-cost-run",
    agent: {} as AdapterExecutionContext["agent"],
    runtime: {} as AdapterExecutionContext["runtime"],
    config: {
      model: "fixture-custom-model",
      env: { PAPERCLIP_AI_PROVIDER_KEY: "fixture-key" },
      managedAiRouting: {
        kind: "gateway",
        protocol: "responses",
        baseUrl: "https://custom.fixture/v1",
        auth: "api_key",
        models: [{ id: "fixture-custom-model" }],
      },
    },
    context: { prompt: "Record this provider charge." },
    onLog: async () => {},
  } as unknown as AdapterExecutionContext;
}

describeEmbeddedPostgres("Custom provider reported-cost accounting", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("records a provider-reported charge with its token totals", async () => {
    // This fails if Custom usage stops forwarding its reported cost or if the
    // accounting ledger reclassifies that receipt as unpriced.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "fixture-cost-response",
      output: [{ content: [{ text: "done" }] }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        input_tokens_details: { cached_tokens: 80 },
        cost: "0.012345678",
      },
    }), { status: 200 })));

    try {
      const adapterResult = await executeCustom(customContext());
      expect(adapterResult).toMatchObject({
        exitCode: 0,
        usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20 },
        costUsdExact: "0.012345678",
        costStatus: "reported",
      });

      tempDb = await startEmbeddedPostgresTestDatabase("paperclip-custom-provider-cost-");
      const db = createDb(tempDb.connectionString);
      const companyId = randomUUID();
      const agentId = randomUUID();
      const runId = randomUUID();
      const occurredAt = new Date();

      await db.insert(companies).values({
        id: companyId,
        name: "Custom provider accounting fixture",
        issuePrefix: "CUST",
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "Custom provider agent",
        role: "engineer",
        status: "active",
        adapterType: "custom_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        status: "succeeded",
        createdAt: occurredAt,
        finishedAt: occurredAt,
        costAccountingPending: true,
        usageJson: {
          accountingReceiptReady: true,
          provider: adapterResult.provider,
          biller: adapterResult.biller,
          model: adapterResult.model,
          costUsdExact: adapterResult.costUsdExact,
          costStatus: adapterResult.costStatus,
          pricingProvenance: adapterResult.pricingProvenance,
          billingType: "metered_api",
          ...adapterResult.usage,
        },
      });

      expect(await accountRunCost(db, runId)).toBe(true);

      const costs = costService(db);
      await expect(costs.summary(companyId)).resolves.toMatchObject({
        eventCount: 1,
        unpricedEventCount: 0,
        spendCents: 1.2345678,
      });
      await expect(costs.byAgent(companyId)).resolves.toEqual([
        expect.objectContaining({
          agentId,
          eventCount: 1,
          costCents: 1.2345678,
          inputTokens: 100,
          cachedInputTokens: 80,
          outputTokens: 20,
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
