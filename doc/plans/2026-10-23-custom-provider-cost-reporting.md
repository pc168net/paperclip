# Custom Provider Cost Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist explicit costs returned by Custom/OpenAI-compatible providers so Paperclip's existing Costs pages show recorded charges without inventing a token-based price.

**Architecture:** Parse provider cost and usage from Custom response bodies in a small pure helper. Map valid provider cost into `AdapterExecutionResult.costUsdExact`/`costUsd`, mark it as `reported` with provider provenance, and let the existing usage-receipt and run-cost-accounting pipeline create `cost_events`. Missing or invalid provider cost remains unpriced.

**Tech Stack:** TypeScript, Vitest, Paperclip adapter-utils contracts, existing usage-receipt and cost-event accounting.

**Spec:** `doc/plans/2026-10-23-custom-provider-cost-reporting-design.md`

## Global Constraints

- Only accept an explicit provider-reported cost; do not calculate a fallback from token counts.
- Preserve input, cached-input, and output token counts.
- Mark valid Custom provider cost as `costStatus: "reported"` and `pricingProvenance.source: "provider_reported"`.
- Preserve explicit zero cost as reported; treat missing, negative, non-finite, or malformed cost as unpriced.
- Do not change Anthropic, Codex, or other adapter pricing behavior.
- Do not add a pricing table, Connector pricing UI, network pricing lookup, schema migration, or database backfill.

## Review Focus

- **Provider field compatibility:** both Responses and Chat Completions usage shapes retain token counts and read only the documented explicit cost locations; Task 1 tests both protocols.
- **Exact decimal accounting:** a string cost is preserved in `costUsdExact` rather than rounded through JavaScript number conversion; Task 1 tests decimal precision.
- **Zero versus missing:** explicit `0` is reported while absent cost is unpriced; Task 1 pins both cases.
- **Malformed provider data:** negative, `NaN`, infinity, and non-numeric values do not produce charges or crash the run; Task 1 tests rejection.
- **Downstream accounting:** valid Custom cost reaches the existing ledger as a non-zero `cost_events.cost_cents`, while token-only usage remains unpriced; Task 2 tests the accounting boundary.

---

## File Structure

- `server/src/adapters/custom-local-usage.ts` — pure parser/normalizer for Custom provider usage and explicit cost.
- `server/src/adapters/custom-local-usage.test.ts` — parser contract tests for Responses and Chat Completions payloads.
- `server/src/adapters/custom-local.ts` — map the parser result into `AdapterExecutionResult` on normal completion.
- `server/src/__tests__/heartbeat-cost-accounting.test.ts` — regression coverage for reported Custom receipts and token-only unpriced receipts.
- `server/src/services/run-cost-accounting.ts` — no behavior change expected; verify its existing contract is sufficient.
- `doc/plans/2026-10-23-custom-provider-cost-reporting-design.md` — design source; update only if implementation evidence changes scope.

### Task 1: Parse and Return Explicit Custom Provider Cost

**Files:**
- Create: `server/src/adapters/custom-local-usage.ts`
- Test: `server/src/adapters/custom-local-usage.test.ts`
- Modify: `server/src/adapters/custom-local.ts:83-111, 217-220`

**Interfaces:**
- Produces: `parseCustomProviderUsage(body: Record<string, unknown>): { usage?: UsageSummary; costUsd?: number; costUsdExact?: string; costStatus?: "reported" | "unpriced"; pricingProvenance?: AdapterExecutionResult["pricingProvenance"] }`.
- Consumes: Responses `usage.input_tokens`, `usage.output_tokens`, `usage.input_tokens_details.cached_tokens` and Chat Completions `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`.
- Consumes explicit provider cost from `body.cost` or `body.usage.cost`, accepting a non-negative finite number or a non-negative decimal string; if both are present, `body.usage.cost` wins.
- Produces: a result object that `executeCustom()` spreads into its existing successful `AdapterExecutionResult`.

- [ ] **Step 1: Write failing parser tests for Responses payloads**

Add tests asserting that:

```ts
parseCustomProviderUsage({
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    input_tokens_details: { cached_tokens: 80 },
    cost: "0.012345678",
  },
}).toEqual(expect.objectContaining({
  usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, totalTokens: 120 },
  costUsd: 0.012345678,
  costUsdExact: "0.012345678",
  costStatus: "reported",
  pricingProvenance: expect.objectContaining({ source: "provider_reported" }),
}));
```

- [ ] **Step 2: Add Chat Completions, zero, missing, and invalid-cost tests**

Cover `prompt_tokens`, `completion_tokens`, and `prompt_tokens_details.cached_tokens`; explicit top-level `cost: 0`; no cost field; negative number; `"NaN"`; `Infinity`; and malformed strings. Assert token usage is still returned for malformed/missing cost, but no cost fields or reported status are returned.

- [ ] **Step 3: Run parser tests to verify they fail**

Run: `pnpm exec vitest run server/src/adapters/custom-local-usage.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 4: Implement `parseCustomProviderUsage`**

In `server/src/adapters/custom-local-usage.ts`, normalize both protocol usage shapes, default missing token fields to zero as the current adapter does, and calculate `totalTokens`. Validate cost strings with a strict non-negative decimal format before converting to a number; retain the original normalized decimal string in `costUsdExact`. Use `pricingProvenance: { source: "provider_reported", version: "custom-openai-compatible/v1", evidence: "provider_cost" }` only when cost is valid.

- [ ] **Step 5: Run parser tests to verify they pass**

Run: `pnpm exec vitest run server/src/adapters/custom-local-usage.test.ts`

Expected: PASS.

- [ ] **Step 6: Map the parser in `executeCustom()`**

Replace the local `usage(parsed)` call in the successful no-tool-call return with the helper result: spread `...parsedUsage` alongside the existing `usage`, `usageBasis`, provider, biller, model, result JSON, and session fields. Keep the tool-call continuation behavior unchanged; only the final provider response is recorded.

- [ ] **Step 7: Add an adapter execution regression**

Using the existing Custom adapter test context/fetch stubbing pattern, return a successful Responses payload with tokens, cached tokens, and `usage.cost`, call `executeCustom()`, and assert the result contains the exact cost, reported status, provider provenance, and preserved usage.

- [ ] **Step 8: Run focused adapter tests**

Run: `pnpm exec vitest run server/src/adapters/custom-local-usage.test.ts server/src/adapters/custom-local-test.test.ts server/src/adapters/custom-local.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add server/src/adapters/custom-local-usage.ts server/src/adapters/custom-local-usage.test.ts server/src/adapters/custom-local.ts server/src/adapters/custom-local.test.ts
git commit -m "fix(custom): forward provider-reported cost"
```

### Task 2: Verify Existing Cost Accounting Persists Custom Charges

**Files:**
- Test: `server/src/__tests__/heartbeat-cost-accounting.test.ts`
- Test or modify only if required by evidence: `server/src/services/run-cost-accounting.ts`
- Modify only if evidence changes: `doc/plans/2026-10-23-custom-provider-cost-reporting-design.md`

**Interfaces:**
- Consumes: Task 1's `AdapterExecutionResult` fields and the existing `run-cost-accounting.ts` receipt mapping.
- Produces: a recorded cost event with provider-reported status and non-zero cents for valid Custom cost; token-only Custom usage remains unpriced.

- [ ] **Step 1: Write the failing accounting regression**

Add a test at the existing heartbeat accounting boundary using a Custom-style receipt:

```ts
expect(resolveLedgerCostStatus({
  costUsd: 0.012345678,
  inputTokens: 100,
  cachedInputTokens: 80,
  outputTokens: 20,
})).toBe("reported");
expect(resolveLedgerCostStatus({
  costUsd: null,
  inputTokens: 100,
  cachedInputTokens: 80,
  outputTokens: 20,
})).toBe("unpriced");
```

If the existing helper test already proves this exact behavior, retain it as the regression and add a database-backed `cost_events` assertion only if the Custom adapter path exposes a gap.

- [ ] **Step 2: Run accounting tests to verify the baseline**

Run: `pnpm exec vitest run server/src/__tests__/heartbeat-cost-accounting.test.ts server/src/services/usage-receipts.test.ts server/src/services/costs-service.test.ts`

Expected: PASS or a focused failure showing the missing downstream mapping; do not change accounting behavior without such evidence.

- [ ] **Step 3: Implement only a proven accounting mapping gap**

If the valid Task 1 receipt does not create a `cost_events` charge, update the smallest existing accounting mapping so `costUsdExact`/`costUsd`, `costStatus`, provider, model, and all token fields reach `createCostEventInTransaction`. Do not add token-based estimation. If the existing path already passes, make no production change in this task.

- [ ] **Step 4: Run the focused accounting suite**

Run: `pnpm exec vitest run server/src/__tests__/heartbeat-cost-accounting.test.ts server/src/services/usage-receipts.test.ts server/src/services/costs-service.test.ts`

Expected: PASS, with reported Custom cost non-zero and token-only usage unpriced.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/src/__tests__/heartbeat-cost-accounting.test.ts server/src/services/run-cost-accounting.ts
git commit -m "test(custom): verify provider cost accounting"
```

If no production accounting file changed, omit it from `git add` and use commit message `test(custom): cover provider cost accounting`.

### Task 3: Integrated Verification and Cost-Display Evidence

**Files:**
- Modify only if needed: `tests/e2e/fixtures/custom-openai-provider.ts`
- Test: `tests/e2e/custom-first-agent-connector.spec.ts` only if an existing journey can safely assert the recorded cost.

**Interfaces:**
- Consumes: Task 1 provider response contract and Task 2 accounting behavior.
- Produces: browser/API evidence that a Custom provider-reported charge is visible as recorded cost, while a token-only response remains unpriced.

- [ ] **Step 1: Extend the synthetic Custom provider fixture with an explicit cost**

Add a fixture response mode that returns `usage.input_tokens`, `usage.output_tokens`, `usage.input_tokens_details.cached_tokens`, and `usage.cost` without changing the default fixture behavior used by existing onboarding tests.

- [ ] **Step 2: Add a focused E2E/API assertion**

Run one Custom execution using the explicit-cost fixture, then query the company cost summary/by-agent endpoint and assert non-zero recorded cents, reported event count, and matching token totals. Keep the assertion scoped to the synthetic fixture company.

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm exec vitest run server/src/adapters/custom-local-usage.test.ts server/src/adapters/custom-local.test.ts server/src/__tests__/heartbeat-cost-accounting.test.ts
pnpm exec tsc --noEmit -p server/tsconfig.json
```

Run the Custom Chromium E2E only if the fixture or E2E file changed:

```bash
pnpm exec playwright test tests/e2e/custom-first-agent-connector.spec.ts --project=chromium
```

Expected: all focused checks pass and the explicit provider-reported cost is visible as a recorded charge.

- [ ] **Step 4: Run diff hygiene and document the result**

Run `git diff --check`; record that missing provider cost remains unpriced and no token-based fallback was introduced.

- [ ] **Step 5: Commit Task 3**

```bash
git add tests/e2e/fixtures/custom-openai-provider.ts tests/e2e/custom-first-agent-connector.spec.ts
git commit -m "test(custom): verify displayed provider charges"
```

Omit unchanged files and this commit when existing focused tests already provide the complete evidence.

## Self-Review

- **Spec coverage:** Task 1 maps provider cost into the existing adapter contract; Task 2 verifies the existing accounting pipeline; Task 3 verifies the user-visible cost result.
- **Type consistency:** `parseCustomProviderUsage` returns the exact `AdapterExecutionResult` cost fields consumed by run completion and accounting; no new shared or database contract is introduced.
- **Review focus coverage:** both protocols, exact decimals, zero/missing, invalid values, and downstream charges each have explicit test ownership.
- **Scope:** no pricing table, token estimation, other-adapter behavior, or Connector UI is included.
