# Task 3 Report — Complete deployment APIs and authorization

## Outcome

Implemented deployment read/mutate authorization, duplicate-create 409 behavior, non-verified deployment verification, and Azure discovery guardrails.

### Changed files
- `server/src/routes/ai-connections.ts`
- `server/src/services/ai-deployments.ts`
- `server/src/__tests__/ai-connections.test.ts`

## What changed

- `GET /api/companies/:companyId/ai-connections/:connectionId/deployments`
  - managers see all deployment statuses
  - granted readers see verified deployments only
  - foreign-company / missing-connection access still fails closed
- `POST /deployments`
  - creates stale deployments
  - duplicate model/protocol now returns `409 Conflict`
  - no upsert path remains
- `POST /deployments/:deploymentId/verify`
  - verifies the stored credential for the selected grant
  - can verify a stale deployment and writes the new status + `verifiedCredentialEpoch`
  - includes company + connection predicates in the update
- `DELETE /deployments/:deploymentId`
  - remains company/connection scoped and logs `ai_deployment.deleted`
- `GET /api/companies/:companyId/ai-connections`
  - non-managers now receive verified deployments only in summaries
- Added route tests for:
  - same-company create/list/verify/delete
  - foreign-company 403/404 without leakage
  - duplicate rejection
  - owner/admin/`tools:manage_connections`
  - granted non-manager read access
  - Azure discovery not inserting deployment rows

## Verification

### 1) Focused route tests
Command:
```sh
pnpm --filter @paperclipai/server exec vitest run src/__tests__/ai-connections.test.ts -t "does not create deployment rows during Azure model discovery|authorizes deployment reads and mutations by grant and manager scope"
```

Output:
```text
RUN  v5.0.3 /Users/bruce/Antigravity/paperclip/paperclip/server

Test Files  1 passed (1)
Tests  2 passed | 115 skipped (117)
```

### 2) Deployment service regression coverage
Command:
```sh
pnpm --filter @paperclipai/server exec vitest run src/services/ai-deployments.test.ts -t "deployment resolution and stale propagation"
```

Output:
```text
RUN  v5.0.3 /Users/bruce/Antigravity/paperclip/paperclip/server

Test Files  1 passed (1)
Tests  1 passed | 7 skipped (8)
```

### 3) Direct server TypeScript compile
Command:
```sh
pnpm --filter @paperclipai/server exec tsc -p tsconfig.json --noEmit
```

Output:
```text
(no output)
```

### 4) Full package typecheck attempt
Command:
```sh
pnpm --filter @paperclipai/server typecheck
```

Output excerpt:
```text
sh: cargo: command not found
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @paperclipai/paperclip-runner@0.0.0 build
```

## Notes

- I preserved unrelated dirty files already present in the workspace.
- The package typecheck is blocked by the repo’s runner build step requiring `cargo` in this environment; the direct server compile passed.

## Review fix follow-up

### 5) Focused deployment auth route test after grant-status fix
Command:
```sh
pnpm --filter @paperclipai/server exec vitest run src/__tests__/ai-connections.test.ts -t "authorizes deployment reads and mutations by grant and manager scope"
```

Output:
```text
RUN  v5.0.3 /Users/bruce/Antigravity/paperclip/paperclip/server

Test Files  1 passed (1)
Tests  1 passed | 116 skipped (117)
```

### 6) Deployment service regression coverage after fix
Command:
```sh
pnpm --filter @paperclipai/server exec vitest run src/services/ai-deployments.test.ts -t "deployment resolution and stale propagation"
```

Output:
```text
RUN  v5.0.3 /Users/bruce/Antigravity/paperclip/paperclip/server

Test Files  1 passed (1)
Tests  1 passed | 7 skipped (8)
```

### 7) Direct server TypeScript compile after fix
Command:
```sh
pnpm --filter @paperclipai/server exec tsc -p tsconfig.json --noEmit
```

Output:
```text
(no output)
```
