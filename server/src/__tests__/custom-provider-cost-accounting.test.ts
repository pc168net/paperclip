import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, costEvents, createDb, heartbeatRuns, type Db } from "@paperclipai/db";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { executeCustom } from "../adapters/custom-local.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { accountRunCost } from "../services/run-cost-accounting.js";
import { costRoutes } from "../routes/costs.js";
import { errorHandler } from "../middleware/index.js";
import { startCustomOpenAiProviderFixture } from "../../../tests/e2e/fixtures/custom-openai-provider.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function customContext(baseUrl: string): AdapterExecutionContext {
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
        baseUrl,
        auth: "api_key",
        models: [{ id: "fixture-custom-model" }],
      },
    },
    context: { prompt: "Record this provider charge." },
    onLog: async () => {},
  } as unknown as AdapterExecutionContext;
}

function costApp(db: Db, companyId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    };
    next();
  });
  app.use("/api", costRoutes(db));
  app.use(errorHandler);
  return app;
}

async function accountAdapterResult(db: Db, adapterResult: AdapterExecutionResult) {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const runId = randomUUID();
  const occurredAt = new Date();
  await db.insert(companies).values({
    id: companyId,
    name: "Custom provider accounting fixture",
    issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
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
  return { companyId, agentId, runId };
}

describeEmbeddedPostgres("Custom provider reported-cost accounting", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("reports provider charges through the cost APIs and preserves token-only usage as unpriced", async () => {
    // This fails if Custom usage stops forwarding its reported cost or if the
    // accounting ledger reclassifies that receipt as unpriced.
    let db!: ReturnType<typeof createDb>;
    const provider = await startCustomOpenAiProviderFixture({ responseMode: "reported_cost" });
    try {
      const adapterResult = await executeCustom(customContext(provider.baseUrl));
      expect(adapterResult).toMatchObject({
        exitCode: 0,
        usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20 },
        costUsdExact: "0.012345678",
        costStatus: "reported",
      });

      tempDb = await startEmbeddedPostgresTestDatabase("paperclip-custom-provider-cost-");
      db = createDb(tempDb.connectionString);
      const { companyId, agentId, runId } = await accountAdapterResult(db, adapterResult);

      const [recordedCharge] = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId));
      expect(recordedCharge).toMatchObject({ costStatus: "reported", costCents: 1.2345678 });

      const app = costApp(db, companyId);
      const summary = await request(app).get(`/api/companies/${companyId}/costs/summary`);
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({
        eventCount: 1,
        unpricedEventCount: 0,
        spendCents: 1.2345678,
      });
      const byAgent = await request(app).get(`/api/companies/${companyId}/costs/by-agent`);
      expect(byAgent.status).toBe(200);
      expect(byAgent.body).toEqual([expect.objectContaining({
        agentId,
        eventCount: 1,
        costCents: 1.2345678,
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
      })]);
    } finally {
      await provider.close();
    }

    const tokenOnlyProvider = await startCustomOpenAiProviderFixture({ responseMode: "token_only" });
    try {
      const tokenOnlyResult = await executeCustom(customContext(tokenOnlyProvider.baseUrl));
      expect(tokenOnlyResult).toMatchObject({
        exitCode: 0,
        usage: { inputTokens: 7, cachedInputTokens: 2, outputTokens: 3 },
      });
      expect(tokenOnlyResult).not.toHaveProperty("costUsd");
      expect(tokenOnlyResult).not.toHaveProperty("costStatus");

      const { runId } = await accountAdapterResult(db, tokenOnlyResult);
      const [unpricedCharge] = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId));
      expect(unpricedCharge).toMatchObject({ costStatus: "unpriced", costCents: 0 });
    } finally {
      await tokenOnlyProvider.close();
    }
  });
});
