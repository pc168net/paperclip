# Task 4 Report — Expose a Credential-free Effective Model on Agent Reads

## Status

Implemented and committed: server-projected effective model fields for agent list and detail reads.

## Files changed

- `packages/shared/src/types/agent.ts`
  - Added optional `effectiveModel` and `modelSource` fields to `Agent`.
- `server/src/routes/agents.ts`
  - Added a server-only model projection resolver.
  - List and detail reads append the projection after their existing redaction paths.
  - The resolver parses the stored runtime binding and uses `aiConnectionService.select`, which validates connection state, grant access, install access, and selected verified deployment. It never resolves vault credentials.
- `server/src/__tests__/agent-effective-model-routes.test.ts`
  - Added a real embedded-Postgres route test covering list/detail verified deployment display and configured-model fallback for no binding, stale, and failed deployments.

## RED evidence

1. The task-brief command was attempted first:

   ```text
   pnpm --filter @paperclipai/server test:run ...
   None of the selected packages has a "test:run" script
   ```

2. The equivalent focused Vitest command was then run before implementation:

   ```text
   pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
   FAIL: expected effectiveModel "gpt-5.6-terra" / modelSource "verified_deployment"; fields were absent.
   ```

## GREEN evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
1 test passed

pnpm --filter @paperclipai/shared typecheck
passed
```

## Additional verification

`pnpm --filter @paperclipai/server typecheck` began successfully but could not finish because this environment has no `cargo`; the server vendor preparation attempted a Runner rebuild and stopped at `sh: cargo: command not found`.

`agent-permissions-routes.test.ts` was also run. It had 12 existing mock argument-matcher failures in agent-creation assertions (80/92 passing); the failures do not exercise the new projection path and are recorded here rather than suppressed.

## Self-review

- Only `effectiveModel` and `modelSource` are added by the projection.
- No URL, connection/grant ID, API key, credential material, or deployment `lastError` is copied into those fields.
- Unavailable, stale, failed, or access-denied deployments fall back to configured model/default rather than being advertised as effective.
- The resolver calls existing connection selection/access logic and does not call vault or credential-resolution APIs.
- Company scoping continues through the existing agent route and AI connection service checks.

## Concerns

- The full server typecheck is blocked locally by the missing Rust `cargo` executable, not a TypeScript diagnostic.
- The existing permissions route fixture has unrelated failures as noted above.

## Review-fix follow-up

### Fixed findings

1. Router bindings now parse through `aiRuntimeConnectionBindingSchema`. A router binding has no stable display-time member selection, so it fails closed to `{ effectiveModel: null, modelSource: "adapter_default" }` rather than presenting `adapterConfig.model` as effective.
2. Agent-list projection is now bounded: one accessible-account/deployment read plus two batched connection/install reads for all explicit bindings, rather than one `aiConnectionService.select` call per agent. It keeps active connection/grant audience, compatible harness, installation, verified deployment, and credential-epoch checks before exposing a deployment model.
3. The focused route test now exercises a restricted peer-agent list and detail response. It asserts the exact projection and verifies the redacted response contains no connection URL, grant ID, API key, or deployment error.

### Review-fix RED evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
FAIL: router-bound runner returned { effectiveModel: "gpt-5.6-sol", modelSource: "agent_config" }
```

### Review-fix GREEN evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --filter @paperclipai/shared typecheck
passed

pnpm --filter @paperclipai/server exec tsc --noEmit
passed
```

### Review-fix self-review

- The batch projection only reads connection metadata, grants/audience through the existing connection listing service, deployment metadata, and installs. It does not resolve credentials or call a vault.
- Router model selection remains execution/task-specific, so the read model does not claim a configured model is effective when no safe selected member exists.
- Restricted responses calculate the projection from the persisted row before redaction but return only the two credential-free fields.

## Review-fix round 2

### Fixed regression

The batched projection now requires the parsed binding's `provider` and `method` to match the accessible account metadata, and requires `shared` bindings to use organization/shared grants while `delegated` bindings use personal grants. These mirror the runtime selector's binding identity and ownership gates while retaining the fixed three-read batch shape.

### RED evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
FAIL: an anthropic binding pointed at the OpenAI account and was returned as
{ effectiveModel: "gpt-5.6-terra", modelSource: "verified_deployment" }
```

### GREEN evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --filter @paperclipai/server exec tsc --noEmit
passed
```

### Regression coverage

- An explicit provider mismatch falls back to `adapterConfig.model`.
- A `delegated` binding targeting a shared/organization grant also falls back.
- Both checks run inside the existing batched eligibility pass; no per-agent selector query was reintroduced.

## Review-fix round 3

### Fixed remaining projection behavior

Explicit bindings that name a deployment now initialize to a fail-closed null projection. Only the batched runtime-equivalent eligibility pass may replace that null with a verified deployment model. An agent with no explicit deployment binding still retains the existing configured/default model behavior.

### RED evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
FAIL: invalid provider binding returned { effectiveModel: "gpt-5.6-sol", modelSource: "agent_config" }
```

### GREEN evidence

```text
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --filter @paperclipai/server exec tsc --noEmit
passed
```

### Regression coverage and review

- Provider mismatch, method mismatch, delegated-to-shared ownership mismatch, and shared-to-personal ownership mismatch now all project `{ effectiveModel: null, modelSource: "adapter_default" }`.
- Stale and failed explicit deployments also fail closed to the same null projection.
- The ordinary no-connection agent remains distinct and projects its configured model.
- The existing integration harness does not expose a stable query-counter boundary without asserting SQL/query-builder internals. The resolver remains batched: it calls the account-list service once and makes two set-based reads for all explicit bindings; it does not invoke `aiConnectionService.select` per agent.

## Review-fix round 4

### Fixed remaining null-responsible-user fallback

The explicit deployment binding classification and fail-closed override now run
before the `!userId` return. An agent request without `onBehalfOfUserId` cannot
run the account/grant eligibility checks, so an explicit saved deployment binding
now projects `{ effectiveModel: null, modelSource: "adapter_default" }` rather
than falling back to `adapterConfig.model`. Agents with no explicit deployment
binding still keep the existing configured/default display behavior.

### RED evidence

Added a real embedded-Postgres route regression using an agent actor with no
`onBehalfOfUserId`; it exercises both list and detail reads for a verified,
explicit deployment binding. Before the ordering correction:

```text
$ pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
FAIL  src/__tests__/agent-effective-model-routes.test.ts > agent effective model routes > projects only a verified selected deployment as an agent's effective model
AssertionError: expected { effectiveModel: 'gpt-5.6-sol', …(1) } to deeply equal { effectiveModel: null, …(1) }

- Expected
+ Received
  {
-   "effectiveModel": null,
-   "modelSource": "adapter_default",
+   "effectiveModel": "gpt-5.6-sol",
+   "modelSource": "agent_config",
  }

Test Files  1 failed (1)
Tests       1 failed (1)
```

### GREEN evidence

After moving the existing early return below the fail-closed override:

```text
$ pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

$ pnpm --filter @paperclipai/server exec tsc --noEmit
(no output; exit 0)
```

### Scope and concern

- The correction only reorders the existing explicit-deployment fail-closed
  override; it adds no dependency calls and preserves the batched selector path.
- The focused test covers both public list and detail route projections. The full
  repository suite was not run because this is an ordering-only route regression.

## Review-fix round 5

### Fixed remaining unattributed explicit-binding gap

The projection previously built its fail-closed set only from explicit bindings
that supplied `deploymentId`. Consequently, an agent request without a
responsible user (`userId === null`) could still expose `adapterConfig.model` as
an executable effective model when its explicit `shared` or `delegated` binding
left deployment selection to runtime.

The resolver now classifies every parsed explicit `shared`/`delegated` binding
before the responsible-user check. With no responsible user, all such bindings
return `{ effectiveModel: null, modelSource: "adapter_default" }` immediately,
without account, grant, installation, or deployment reads. Router,
responsible-user, malformed, and absent bindings preserve their existing
semantics. In particular, an agent with no explicit binding retains its normal
configured/default projection.

### RED evidence

Added real embedded-Postgres route coverage for an unattributed agent reading a
shared explicit binding with no `deploymentId`. Before the correction:

```text
$ pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
FAIL  src/__tests__/agent-effective-model-routes.test.ts > agent effective model routes > projects only a verified selected deployment as an agent's effective model
AssertionError: expected { effectiveModel: 'gpt-5.6-sol', …(1) } to deeply equal { effectiveModel: null, …(1) }
```

### GREEN evidence

```text
$ pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-effective-model-routes.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

$ pnpm --filter @paperclipai/server exec tsc --noEmit
(no output; exit 0)

$ pnpm --filter @paperclipai/shared typecheck
passed

$ git diff --check
(no output; exit 0)
```

### Regression coverage and review

- An unattributed agent receives fail-closed projections for both an explicit
  `shared` binding and an explicit `delegated` binding that omit `deploymentId`,
  through both agent-list and agent-detail routes.
- An unattributed agent with no explicit AI binding still receives the configured
  `gpt-5.6-sol` projection, proving the fail-closed classification does not
  erase the normal configured/default path.
- The early return avoids extra account/grant/deployment queries for requests
  that cannot validate an explicit binding. Attributed bindings retain the
  existing batched account and set-based connection/install reads.
