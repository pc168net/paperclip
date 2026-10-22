# Task 2 Report — Credential epoch propagation and deployment service

## Result

Implemented the AI deployment service contract and credential-epoch propagation for AI connection saves.

## Commit

- Code commit: `34d74cfd266a5efdaac717c0d60e6c5de4385dc5`

## Exact task-2 file set

```text
server/src/__tests__/ai-connections.test.ts
server/src/routes/ai-connections.ts
server/src/services/ai-connections.ts
server/src/services/ai-deployments.test.ts
server/src/services/ai-deployments.ts
```

## Verification

### Focused new tests

Command:

```sh
pnpm exec vitest run server/src/services/ai-deployments.test.ts -t "marks only verified deployments stale for the touched connection and resolves current verified deployments"
```

Output:

```text
Test Files  1 passed (1)
Tests  1 passed | 4 skipped (5)
```

Command:

```sh
pnpm exec vitest run server/src/__tests__/ai-connections.test.ts -t "bumps the credential epoch and stales only verified deployments after a successful credential replacement, but not after a failed save"
```

Output:

```text
Test Files  1 passed (1)
Tests  1 passed | 114 skipped (115)
```

### Compile check

Command:

```sh
pnpm --filter @paperclipai/server exec tsc --noEmit
```

Output:

```text
(no output)
```

### Environment note

`pnpm --filter @paperclipai/server typecheck` fails in this environment because the runner build path needs `cargo`, which is not installed here. The failure is outside the Task 2 code changes.

## Self-review

- Kept the canonical deployment statuses: `stale | verified | failed`
- Preserved `lastError` and `verifiedCredentialEpoch` on deployment rows
- Avoided `/models` as deployment evidence
- Kept stale propagation company/connection scoped
- Confirmed the new service interfaces are the ones used by the route
