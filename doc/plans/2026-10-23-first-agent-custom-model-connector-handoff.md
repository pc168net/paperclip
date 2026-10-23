# First-Agent Custom Model Connector Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let first-organization onboarding defer custom-model setup to the existing Agent Runtime → Connector → verified-deployment flow, rather than maintaining a separate endpoint/key/model form.

**Architecture:** The onboarding wizard will still create the organization and its first `custom_local` agent, but without a gateway route, credential, model, or managed binding. It will send the operator to that agent’s existing Runtime configuration, where `AiConnectionField` and Connector management create a company-scoped Connector, add a deployment, verify it by inference, and bind it to the agent. The existing Agent Runtime UI becomes the only custom endpoint/model configuration owner.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, existing `AiConnectionField` / `AiProviderSetup` Connector UI.

**Spec:** User-approved requirement in this conversation: first-agent onboarding must skip custom model configuration and reuse the existing new-agent model/Connector flow.

## Global Constraints

- Connector, grant, deployment, and agent binding remain company-scoped; never carry a draft binding across organizations.
- Custom endpoint URL, credential, protocol, deployment name, and inference verification live only in Connectors; onboarding must not collect or persist them.
- A custom deployment may bind to an agent only after its existing inference verification succeeds.
- An unconfigured first custom agent must not be presented as ready to receive a task; direct the operator to Runtime configuration.
- Keep raw credentials out of onboarding draft/localStorage and agent adapter config.
- Follow `DESIGN.md` token-only UI rules; run `pnpm check:token-gates` for UI changes.

## Review Focus

- A returning wizard draft that contains old `customProtocol`, `customAuth`, `url`, or discovery data must not restore an endpoint or credential UI; Task 1 adds this regression case.
- Creating a `custom_local` first agent with no Connector must not call the custom environment probe or write `managedAiRouting`; Task 2 tests the exact hire payload.
- A custom first agent must route to its own Runtime page after creation, not to task assignment; Task 2 tests the saved-state primary action.
- The Runtime page’s custom model path must open the existing advanced Connector setup rather than an OpenAI default-account flow; Task 3 tests the `preferAdvanced` handoff.
- Existing Claude/Codex onboarding source, subscription, and API-key paths must remain unchanged; Task 4 runs their existing onboarding suites alongside the new focused tests.

---

## File Structure

- `ui/src/components/OnboardingWizard.tsx` — remove the onboarding-owned custom gateway form and create a deferred, unconfigured custom agent.
- `ui/src/components/OnboardingWizard.test.tsx` — replace old custom-gateway onboarding expectations with deferred-runtime configuration coverage.
- `ui/src/components/AgentConfigForm.tsx` — make the existing Runtime connection field start in advanced Connector mode for `custom_local` agents.
- `ui/src/components/AgentConfigForm*.test.tsx` — prove the custom Runtime path delegates to the existing advanced Connector UI; use the existing focused AgentConfigForm test file if present rather than adding a duplicate suite.
- `ui/src/components/ai-connections/AiConnectionField.test.tsx` — extend only if the AgentConfigForm seam cannot prove the advanced handoff directly.

### Task 1: Remove the onboarding-owned custom gateway form

**Files:**
- Modify: `ui/src/components/OnboardingWizard.tsx:160-304, 620-761, 1931-2063, 2896-3197`
- Modify: `ui/src/components/OnboardingWizard.test.tsx:2049-2165`

**Interfaces:**
- Consumes: existing `adapterType === "custom_local"` source tile and the wizard’s `createdCompanyId` / `createdAgentId` state.
- Produces: a custom source selection that creates an agent with no Connector-specific adapter config or runtime binding.

- [ ] **Step 1: Replace the old custom-gateway form test with a failing deferred-flow test**

  In `OnboardingWizard.test.tsx`, replace the test that expects `Base URL` and `Discover models` with `defers custom gateway setup to the created agent runtime`.

  Assert that selecting `custom_local`:
  - does not render Base URL, authentication, protocol, API key, model, or discovery controls;
  - displays contextual copy that the model is configured after agent creation; and
  - does not call `aiConnectionsApi.discoverCustom`.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `pnpm --filter @paperclipai/ui exec vitest run src/components/OnboardingWizard.test.tsx -t "defers custom gateway setup"`

  Expected: FAIL because the wizard still renders and owns the custom gateway controls.

- [ ] **Step 3: Remove custom gateway setup state and rendering from `OnboardingWizard.tsx`**

  Delete the onboarding-only custom URL, auth, protocol, discovery, and credential UI/state (`customProtocol`, `customAuth`, `customDiscovery`, `discoverCustomGateway`, and the custom card). Keep `custom_local` as a model-source tile, but replace the card with non-editable handoff copy.

  Do not remove unrelated provider login/API-key state used by Claude, Codex, OpenCode, or other adapters.

- [ ] **Step 4: Make stale drafts harmless**

  Ensure legacy wizard draft keys such as `customProtocol`, `customAuth`, `url`, and custom discovery selections are ignored for `custom_local`. Do not write them back to persisted wizard state, and do not erase other current-company onboarding state.

- [ ] **Step 5: Run the focused test to verify it passes**

  Run: `pnpm --filter @paperclipai/ui exec vitest run src/components/OnboardingWizard.test.tsx -t "defers custom gateway setup"`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add ui/src/components/OnboardingWizard.tsx ui/src/components/OnboardingWizard.test.tsx
  git commit -m "refactor: defer onboarding custom model setup"
  ```

### Task 2: Create an unconfigured custom first agent and hand off to Runtime

**Files:**
- Modify: `ui/src/components/OnboardingWizard.tsx:2237-2483, 1492-1517, 952-1000`
- Modify: `ui/src/components/OnboardingWizard.test.tsx`

**Interfaces:**
- Consumes: Task 1’s custom-source selection, `agentsApi.hire(companyId, input)`, and `agentUrl(created)`.
- Produces: a valid `custom_local` first-agent hire with no `managedAiRouting` / `aiConnection`, followed by a Runtime configuration handoff.

- [ ] **Step 1: Write failing hire-payload and completion-action tests**

  Add `creates an unconfigured custom first agent and opens runtime configuration` to `OnboardingWizard.test.tsx`.

  Drive the wizard through company creation, first-agent name, and Custom model source. Assert the hire payload uses:

  ```ts
  {
    adapterType: "custom_local",
    adapterConfig: expect.not.objectContaining({ managedAiRouting: expect.anything() }),
    runtimeConfig: expect.not.objectContaining({ aiConnection: expect.anything() }),
  }
  ```

  Assert `agentsApi.testEnvironment` is not called for this deferred custom agent. After the hire, assert the primary action says `Configure model` and navigates to `${agentUrl(created)}/runtime` instead of creating a task.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `pnpm --filter @paperclipai/ui exec vitest run src/components/OnboardingWizard.test.tsx -t "creates an unconfigured custom first agent"`

  Expected: FAIL because the current wizard requires URL/model/key, probes the endpoint, and writes custom routing before hiring.

- [ ] **Step 3: Add the deferred custom-agent branch to `handleGiveHeartbeat()`**

  For `adapterType === "custom_local"`:
  - skip custom endpoint validation, credential storage, and adapter environment probing;
  - build only the adapter’s safe baseline config (retain `provider: "custom"` only if the adapter requires it);
  - omit `managedAiRouting` and `runtimeConfig.aiConnection`;
  - preserve the existing first-agent persona marker and approval behavior.

  Keep all non-custom onboarding paths unchanged.

- [ ] **Step 4: Change completion copy and action for deferred custom agents**

  In the saved/review state, show that the agent needs a verified model connection before it can work. The primary action must navigate to the created agent’s Runtime page. Do not offer `Assign <agent> a Task` until the binding exists.

- [ ] **Step 5: Run the focused test to verify it passes**

  Run: `pnpm --filter @paperclipai/ui exec vitest run src/components/OnboardingWizard.test.tsx -t "creates an unconfigured custom first agent"`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add ui/src/components/OnboardingWizard.tsx ui/src/components/OnboardingWizard.test.tsx
  git commit -m "feat: hand off first custom agent to runtime setup"
  ```

### Task 3: Make existing Runtime configuration open the custom Connector flow

**Files:**
- Modify: `ui/src/components/AgentConfigForm.tsx:1722-1725`
- Test: existing focused AgentConfigForm test file, or `ui/src/components/ai-connections/AiConnectionField.test.tsx`

**Interfaces:**
- Consumes: the existing `AiConnectionField` prop `preferAdvanced` and `AiProviderSetup` advanced-provider flow.
- Produces: a `custom_local` Runtime configuration that begins with the existing Custom endpoint Connector flow and returns a normal verified deployment binding.

- [ ] **Step 1: Write a failing Runtime handoff test**

  Render an unconfigured `custom_local` agent configuration and select its connection action. Assert that the advanced Connector setup is shown (the existing `Custom endpoint` provider choice), not the standard OpenAI account/default flow.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run the exact focused test file and test name selected in Step 1.

  Expected: FAIL because `AgentConfigForm` does not currently pass `preferAdvanced` for `custom_local`.

- [ ] **Step 3: Pass `preferAdvanced` for `custom_local` to the existing `AiConnectionField`**

  Keep Connector ownership, deployment creation, and inference verification inside `AiConnectionField` / `AiProviderSetup`; do not recreate those inputs in onboarding or `AgentConfigForm`.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run the exact focused test command from Step 2.

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add ui/src/components/AgentConfigForm.tsx ui/src/components/AgentConfigForm*.test.tsx ui/src/components/ai-connections/AiConnectionField.test.tsx
  git commit -m "feat: route custom agents through connector setup"
  ```

### Task 4: Verify the unified onboarding and Connector journey

**Files:**
- Modify only if test fixture contracts need alignment: `ui/src/components/new-agent/NewAgentSetup.deployment.test.tsx`, `ui/src/components/ai-connections/AiConnectionField.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3 and existing verified deployment selection contracts.
- Produces: evidence that onboarding does not bypass company isolation or deployment verification.

- [ ] **Step 1: Add a regression test for a selected verified deployment after Runtime handoff**

  Use the existing deployment fixture pattern in `NewAgentSetup.deployment.test.tsx` or `AiConnectionField.test.tsx`. Assert that the binding persisted after Connector completion includes `connectionId`, `grantId`, and `deploymentId`; assert stale/failed deployments remain unavailable.

- [ ] **Step 2: Run the focused UI tests**

  Run:

  ```bash
  pnpm --filter @paperclipai/ui exec vitest run \
    src/components/OnboardingWizard.test.tsx \
    src/components/new-agent/NewAgentSetup.deployment.test.tsx \
    src/components/ai-connections/AiConnectionField.test.tsx \
    src/components/ai-connections/AiConnectionSelect.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 3: Run UI static verification**

  Run:

  ```bash
  pnpm --filter @paperclipai/ui typecheck
  pnpm check:token-gates
  ```

  Expected: both commands exit 0.

- [ ] **Step 4: Perform a local journey check**

  In a fresh organization: create the first agent, choose Custom model, confirm no credential/endpoint form appears in onboarding, open Runtime configuration, create a Custom endpoint Connector, add and inference-verify a deployment, bind it, save, and assign a task. Confirm the saved binding is company-local and contains the verified deployment ID.

- [ ] **Step 5: Commit**

  ```bash
  git add ui/src/components
  git commit -m "test: cover deferred custom onboarding connection flow"
  ```

## Self-Review

- **Spec coverage:** Task 1 removes the duplicate first-agent custom gateway flow; Task 2 defers creation safely; Task 3 reuses the existing Agent Runtime Connector flow; Task 4 verifies verified-deployment and company-boundary behavior. No requirement gaps identified.
- **Step scan:** Each task begins with a failing behavior test, implements one isolated boundary, and reruns focused verification before commit.
- **Type consistency:** The plan reuses existing `AiConnectionBinding`, `AiConnectionField`, and `AiProviderSetup` contracts; it introduces no new cross-layer contract.
- **Review focus:** Each listed risk is assigned to Task 1, 2, 3, or 4.
- **Proportion:** This is one UI/workflow consolidation project. It avoids schema/API changes and keeps Connector verification logic in its current owners.

## Execution Handoff

Plan complete and saved to `doc/plans/2026-10-23-first-agent-custom-model-connector-handoff.md`.

Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — independent implementation/review per task; thorough but more expensive.
- **Native** — I implement the tasks in this session, then perform one final review; faster and cheaper.

For this plan I recommend **Native**, because the four tasks depend on the same `OnboardingWizard` state transitions and existing Connector UI interfaces. Does the plan capture what you want, and which approach should we use?
