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
