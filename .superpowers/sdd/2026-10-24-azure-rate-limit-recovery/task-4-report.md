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
