# Azure Rate-limit Recovery and Effective Model Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify Azure/Codex token rate limits as bounded provider-capacity failures with optional fallback execution, and display each agent's effective connected model in the board UI.

**Architecture:** Extend the existing native provider-overload lifecycle instead of creating a second retry system: the provider-failure observation emits a safe rate-limit code, finalization arbitration recognizes either capacity cause, and the existing scheduled-retry materializer carries the cause and an explicitly configured fallback. Add a server-resolved, credential-free model display projection to the shared Agent API so both agent-list variants and Agent Overview use the model selected by a verified deployment.

**Tech Stack:** TypeScript, Express, Drizzle/PostgreSQL, Vitest, React, React Testing Library.

**Spec:** `doc/plans/2026-10-24-azure-rate-limit-recovery-design.md`

## Global Constraints

- Classify only authoritative Codex `turn.failed` evidence whose terminal state is failed.
- Persist only closed diagnostic vocabulary; never persist arbitrary Azure provider messages, regions, deployment names, prompts, or credentials.
- Provider rate-limit retries remain bounded to two attempts: five minutes, then fifteen minutes.
- Use only an explicit `agent.adapterConfig.fallbackModel`; never infer a sibling model.
- Preserve task ownership, pause, budget, cancellation, workspace-finalization, and status-decision fences on retries.
- Keep existing `native_provider_overloaded` and model-rejection behavior unchanged.
- Effective-model API projection must contain no connection URL, grant ID, credential, or secret.
- Follow `rules/product-harness-responsibility.mdc`: routine safe retries belong to the harness, while UI exposes only actionable state.

## Review Focus

- A malformed or arbitrary provider error that merely contains “rate limit” must remain an unclassified failure; Task 1 tests exact structured evidence only.
- A rate-limited run that no longer owns its issue must not create a retry or alter the reassigned task; Task 2 exercises reassignment.
- A third consecutive rate-limited run must block the task without adding another scheduled retry; Task 2 exercises exhaustion.
- A fallback model must be used only for a rate-limit scheduled retry, never for a normal run or an overloaded retry unless that existing behavior already applies; Task 3 exercises all three selections.
- A disconnected, stale, inaccessible, or non-verified deployment must not be displayed as an effective model; Task 4 exercises fallback to configured/default model.

---

### Task 1: Classify Codex Rate-limit Evidence Safely

**Files:**
- Modify: `server/src/services/native-runtime/native-provider-failure.ts`
- Modify: `server/src/services/native-runtime/native-provider-failure.test.ts`

**Interfaces:**
- Produces: `NATIVE_PROVIDER_RATE_LIMITED_CODE`, `NATIVE_PROVIDER_RATE_LIMITED_MESSAGE`, and a `forTerminal()` result with `{ errorCode: "native_provider_rate_limited", diagnostic: { provider: "codex", category: "rate_limited" } }`.
- Consumed by: Task 2 finalization/arbitration changes.

- [ ] **Step 1: Add failing provider-observation tests for structured rate-limit evidence**

  In `native-provider-failure.test.ts`, add a failed Codex turn with `error.codexErrorInfo: "rate_limit_exceeded"` and assert:

  ```ts
  expect(observed.forTerminal("turn", terminal)).toEqual({
    errorCode: "native_provider_rate_limited",
    errorMessage: NATIVE_PROVIDER_RATE_LIMITED_MESSAGE,
    diagnostic: { provider: "codex", category: "rate_limited" },
  });
  ```

  Add negative cases for a different turn, a succeeded terminal, a recoverable event, and arbitrary message text without exact structured error info. Assert the diagnostic JSON does not contain the provider message.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `pnpm --filter @paperclipai/server test:run src/services/native-runtime/native-provider-failure.test.ts`

  Expected: FAIL because `rate_limit_exceeded` is not yet a classified provider failure.

- [ ] **Step 3: Add the closed rate-limit classification in `native-provider-failure.ts`**

  Add the code/message/diagnostic constants beside `native_provider_overloaded`. In `createNativeProviderFailureObservation`, bind exact `codexErrorInfo === "rate_limit_exceeded"` to the turn and return the closed rate-limit result from `forTerminal()`. Do not parse or retain provider text.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `pnpm --filter @paperclipai/server test:run src/services/native-runtime/native-provider-failure.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the isolated classification change**

  ```bash
  git add server/src/services/native-runtime/native-provider-failure.ts server/src/services/native-runtime/native-provider-failure.test.ts
  git commit -m "feat: classify native provider rate limits"
  ```

### Task 2: Route Rate Limits Through Existing Capacity Recovery

**Files:**
- Modify: `server/src/services/native-runtime/status-arbiter.ts`
- Modify: `server/src/services/native-runtime/status-decision-committer.ts`
- Modify: `server/src/services/native-runtime/native-run-finalizer.ts`
- Modify: `server/src/services/native-runtime/native-provider-capacity-retry.ts`
- Modify: `server/src/services/native-runtime/native-provider-overload.integration.test.ts`

**Interfaces:**
- Consumes: `NATIVE_PROVIDER_RATE_LIMITED_CODE` and message from Task 1.
- Produces: Scheduled retries with `scheduledRetryReason: "native_provider_rate_limited"`, preserving the existing 5-minute/15-minute schedule, exhaustion behavior, and recovery ownership guarantees.
- Consumed by: Task 3 runtime selection and UI state projection.

- [ ] **Step 1: Add a failing native integration case for rate-limited retries**

  Extend `native-provider-overload.integration.test.ts` so its provider event fixture accepts a `codexErrorInfo` and expected code/message. Add a `rate_limit_exceeded` scenario that asserts:

  - failed adapter/run uses `native_provider_rate_limited`;
  - the first and second successors are `scheduled_retry` after approximately 5 and 15 minutes;
  - the third failure creates no successor and blocks the task;
  - finalization replay creates no duplicate retry or recovery action;
  - reassignment before finalization creates no retry.

- [ ] **Step 2: Run the rate-limit integration case and verify it fails**

  Run: `pnpm --filter @paperclipai/server test:run src/services/native-runtime/native-provider-overload.integration.test.ts`

  Expected: FAIL because status arbitration only recognizes `native_provider_overloaded`.

- [ ] **Step 3: Generalize capacity-retry policy to accept both known capacity codes**

  In the native runtime modules, introduce a narrow predicate/type for capacity retry codes containing exactly:

  ```ts
  "native_provider_overloaded" | "native_provider_rate_limited"
  ```

  Use it to:

  - pass `providerRateLimited` from `native-run-finalizer.ts` to `status-arbiter.ts`;
  - issue the same bounded `schedule_retry` decision for either cause;
  - dispatch either cause through `materializeNativeProviderCapacityRetry`;
  - preserve the specific code/message in scheduled run, wake request, activity details, retry accounting, exhaustion recovery action, and user-facing block action.

  Do not alter handling for unknown failures, model rejection, or `serverOverloaded`.

- [ ] **Step 4: Run the integration test and verify it passes**

  Run: `pnpm --filter @paperclipai/server test:run src/services/native-runtime/native-provider-overload.integration.test.ts`

  Expected: PASS, including retries at 5 then 15 minutes and no third retry.

- [ ] **Step 5: Run the adjacent native-provider suites**

  Run: `pnpm --filter @paperclipai/server test:run src/services/native-runtime/native-provider-failure.test.ts src/services/native-runtime/native-provider-overload.integration.test.ts`

  Expected: PASS.

- [ ] **Step 6: Commit native recovery changes**

  ```bash
  git add server/src/services/native-runtime/status-arbiter.ts server/src/services/native-runtime/status-decision-committer.ts server/src/services/native-runtime/native-run-finalizer.ts server/src/services/native-runtime/native-provider-capacity-retry.ts server/src/services/native-runtime/native-provider-overload.integration.test.ts
  git commit -m "feat: retry native provider rate limits"
  ```

### Task 3: Apply Explicit Fallback Model to Rate-limit Retries

**Files:**
- Modify: `server/src/services/heartbeat/runtime-selection.ts`
- Modify: `server/src/services/heartbeat/runtime-selection.test.ts` (or the existing focused runtime-selection test file if differently named)

**Interfaces:**
- Consumes: `scheduledRetryReason: "native_provider_rate_limited"` created in Task 2 and existing `readConfiguredFallbackModel()`.
- Produces: A retry-time provider config using explicit `fallbackModel.provider` and `fallbackModel.model` only for the two capacity retry reasons.

- [ ] **Step 1: Add failing runtime-selection tests**

  Add tests that prepare a Paperclip Runner Codex agent with:

  ```ts
  adapterConfig: {
    provider: "codex",
    model: "gpt-5.6-terra",
    fallbackModel: { provider: "codex", model: "gpt-5.6-sol" },
  }
  ```

  Assert a run scheduled for `native_provider_rate_limited` resolves the native provider as `gpt-5.6-sol`. Assert normal runs retain Terra; assert rate-limited runs without `fallbackModel` retain Terra; assert existing overloaded retry behavior remains unchanged.

- [ ] **Step 2: Run the focused runtime-selection test and verify it fails**

  Run: `pnpm --filter @paperclipai/server test:run src/services/heartbeat/runtime-selection.test.ts`

  Expected: FAIL because fallback selection currently gates only on `native_provider_overloaded`.

- [ ] **Step 3: Extend fallback gating to both capacity retry reasons**

  Replace the exact overloaded-code comparison around `configuredRateLimitFallback` with the shared capacity-retry predicate from Task 2. Preserve current `managedAiRuntime` model precedence and use the fallback only when explicitly configured.

- [ ] **Step 4: Run focused and capacity integration tests**

  Run: `pnpm --filter @paperclipai/server test:run src/services/heartbeat/runtime-selection.test.ts src/services/native-runtime/native-provider-overload.integration.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit fallback selection**

  ```bash
  git add server/src/services/heartbeat/runtime-selection.ts src/services/heartbeat/runtime-selection.test.ts
  git commit -m "feat: apply fallback model after provider rate limits"
  ```

### Task 4: Expose a Credential-free Effective Model on Agent Reads

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `server/src/routes/agents.ts`
- Modify: `server/src/__tests__/agent-permissions-routes.test.ts` (or a focused new `agent-effective-model-routes.test.ts`)

**Interfaces:**
- Produces: Optional `Agent.effectiveModel` and `Agent.modelSource` fields, where `modelSource` is `"verified_deployment" | "agent_config" | "adapter_default"`.
- Consumed by: Task 5 board UI.

- [ ] **Step 1: Add failing API tests for model projection**

  Seed a Paperclip Runner Codex agent with `adapterConfig.model: "gpt-5.6-sol"`, a compatible saved AI connection, and a verified deployment `gpt-5.6-terra`. Assert both `GET /api/companies/:companyId/agents` and `GET /api/agents/:id` return:

  ```ts
  { effectiveModel: "gpt-5.6-terra", modelSource: "verified_deployment" }
  ```

  Add cases for no connection, stale/failed deployment, and a restricted response. Assert no response exposes connection URL, grant ID, API key, or deployment `lastError` through the new fields.

- [ ] **Step 2: Run the focused route test and verify it fails**

  Run: `pnpm --filter @paperclipai/server test:run src/__tests__/agent-effective-model-routes.test.ts`

  Expected: FAIL because Agent reads do not yet contain effective-model fields.

- [ ] **Step 3: Add a server-side Agent display-model resolver**

  Add a focused resolver adjacent to the agent route/read-model code. It must inspect the agent's parsed runtime AI connection binding, use existing connection/deployment selection/access services, and return only:

  ```ts
  type AgentModelProjection = {
    effectiveModel: string | null;
    modelSource: "verified_deployment" | "agent_config" | "adapter_default";
  };
  ```

  Apply it consistently in list and detail routes after the existing row redaction. Do not call vault/credential resolution and do not duplicate runtime connection-routing rules in the client.

- [ ] **Step 4: Extend shared Agent types and pass the route tests**

  Add optional fields to `Agent` in `packages/shared/src/types/agent.ts`, update route responses, and run:

  ```bash
  pnpm --filter @paperclipai/server test:run src/__tests__/agent-effective-model-routes.test.ts
  pnpm --filter @paperclipai/shared typecheck
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the API read model**

  ```bash
  git add packages/shared/src/types/agent.ts server/src/routes/agents.ts server/src/__tests__/agent-effective-model-routes.test.ts
  git commit -m "feat: expose effective agent models"
  ```

### Task 5: Render Effective Model and Rate-limit Recovery State

**Files:**
- Modify: `ui/src/pages/Agents.tsx`
- Modify: `ui/src/pages/Agents.production.tsx`
- Modify: `ui/src/pages/Agents.test.tsx`
- Modify: `ui/src/pages/AgentDetail.tsx`
- Modify: `ui/src/pages/AgentDetail.history.test.tsx` (or a focused new AgentDetail overview test)

**Interfaces:**
- Consumes: `Agent.effectiveModel`, `Agent.modelSource`, and rate-limit scheduled retry/run error code from Tasks 2 and 4.
- Produces: Board UI that presents the effective model, its source when it differs from configured model, and an actionable rate-limit recovery state.

- [ ] **Step 1: Add failing UI tests for effective-model display**

  Update `Agents.test.tsx` for both streamlined and production list components. Render an agent with configured Sol and effective Terra, then assert Terra is the primary model text and a source hint identifies the connection deployment. Add an Agent Overview test with the same data and assert the effective Terra model is shown.

- [ ] **Step 2: Run UI tests and verify they fail**

  Run: `pnpm --filter @paperclipai/ui test:run src/pages/Agents.test.tsx src/pages/AgentDetail.history.test.tsx`

  Expected: FAIL because both views currently read only `adapterConfig.model`.

- [ ] **Step 3: Replace client-side configured-model reads with the server projection**

  In both Agents page variants and `AgentDetail.tsx`, render `agent.effectiveModel` as the primary value, with the legacy configured/default value only as a short source hint when different. Retain graceful fallback for older/incomplete API data.

- [ ] **Step 4: Add a rate-limit recovery presentation test and implementation**

  In the existing Run/Task status rendering path, add a test fixture for `errorCode: "native_provider_rate_limited"` with a scheduled retry. Assert it says the model is rate limited, includes the scheduled retry timing, and identifies configured fallback model only when the run context contains one. Implement the smallest status-label mapping required; do not render raw provider text or internal run identifiers.

- [ ] **Step 5: Run UI verification**

  Run: `pnpm --filter @paperclipai/ui test:run src/pages/Agents.test.tsx src/pages/AgentDetail.history.test.tsx`

  Expected: PASS.

- [ ] **Step 6: Commit UI presentation**

  ```bash
  git add ui/src/pages/Agents.tsx ui/src/pages/Agents.production.tsx ui/src/pages/Agents.test.tsx ui/src/pages/AgentDetail.tsx ui/src/pages/AgentDetail.history.test.tsx
  git commit -m "feat: show effective models and rate-limit recovery"
  ```

### Task 6: Full Focused Verification and Documentation Alignment

**Files:**
- Modify: `doc/connections/AI-CONNECTIONS.md`
- Modify: `doc/plans/2026-10-24-azure-rate-limit-recovery-design.md` (only if implementation decisions require clarification)

**Interfaces:**
- Consumes: Tasks 1–5 implementation and tests.
- Produces: Operator-facing documentation stating the bounded native rate-limit recovery behavior and model-source display semantics.

- [ ] **Step 1: Document operator-visible rate-limit behavior**

  Add a concise note to `doc/connections/AI-CONNECTIONS.md`: provider token rate limits are retried at 5 then 15 minutes for Paperclip Runner native execution; an explicit fallback model may be selected; unknown/provider errors are not automatically retried; the effective deployment model can differ from the saved agent model.

- [ ] **Step 2: Run all targeted test files**

  Run:

  ```bash
  pnpm --filter @paperclipai/server test:run \
    src/services/native-runtime/native-provider-failure.test.ts \
    src/services/native-runtime/native-provider-overload.integration.test.ts \
    src/services/heartbeat/runtime-selection.test.ts \
    src/__tests__/agent-effective-model-routes.test.ts
  pnpm --filter @paperclipai/ui test:run \
    src/pages/Agents.test.tsx \
    src/pages/AgentDetail.history.test.tsx
  pnpm -r typecheck
  ```

  Expected: all commands exit 0.

- [ ] **Step 3: Commit documentation and any design clarification**

  ```bash
  git add doc/connections/AI-CONNECTIONS.md doc/plans/2026-10-24-azure-rate-limit-recovery-design.md
  git commit -m "docs: explain native rate-limit recovery"
  ```

## Plan Self-review

- **Spec coverage:** Tasks 1–3 cover safe classification, bounded retry and explicit fallback; Tasks 4–5 cover effective-model API and UI; Task 6 covers operator guidance and whole-change verification.
- **Type consistency:** the exact rate-limit code is `native_provider_rate_limited`; both capacity codes are consumed through a shared predicate; API fields are `effectiveModel` and `modelSource`.
- **Review focus coverage:** malformed evidence is Task 1; reassignment and exhaustion are Task 2; fallback scope is Task 3; deployment availability/access is Task 4.
- **Proportion:** six tasks align to independent reviewable contracts without reproducing production implementation.
