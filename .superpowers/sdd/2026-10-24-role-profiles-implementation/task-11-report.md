# Task 11 report — isolate managed AI-connection fixtures

## Status

Implemented the test-only managed-runtime fixture isolation. Production runtime
and project-auth security code were not changed.

## Changes

- The suite creates an empty `execution-root` below its temporary `home`.
- Test-local wrappers supply that root as `adapterConfig.cwd` to every
  `prepareManagedAiRuntime` and `withManagedAiProbe` invocation unless a test
  explicitly provides a cwd.
- Added a real Anthropic managed-runtime regression proving the suite root does
  not inherit host Claude authentication settings.
- The direct project-auth discovery coverage (`assertManagedAiProjectAuth`) is
  unchanged and deliberately does not use the fixture wrapper.

## TDD evidence

### RED

Command:

```sh
pnpm exec vitest run --project @paperclipai/server --exclude '**/dist/**' \
  --pool=forks --isolate --no-file-parallelism --maxWorkers=1 \
  server/src/__tests__/ai-connections.test.ts \
  -t 'does not inherit host Claude auth from the suite-owned execution root'
```

Result: exit 1; 1 failed, 122 skipped. The new regression failed at
`assertManagedAiProjectAuth` with `Project authentication settings conflict
with the selected AI connection`, confirming it was reaching host Claude auth
configuration before the fixture supplied its cwd.

### GREEN

The same command after fixture wiring: exit 0; 1 passed, 122 skipped.

## Focused-file verification

Command (host configuration was neither masked nor changed):

```sh
pnpm exec vitest run --project @paperclipai/server --exclude '**/dist/**' \
  --pool=forks --isolate --no-file-parallelism --maxWorkers=1 \
  server/src/__tests__/ai-connections.test.ts
```

Result: exit 1; 118 passed, 5 failed (123 total). No failure was a managed
project-auth conflict. Remaining failures are:

1. `vaults routed credentials, enforces compatibility and access, and configures both Codex runners`
2. `reconnects JSONB routing without changing its identity or access`
3. `authorizes deployment reads and mutations by grant and manager scope`
4. `validates runner account adoption in the inherited sandbox (inline: true)`
5. `creates and hires agents with an authorized restricted shared connection`

The narrow regression command passed. `pnpm --filter @paperclipai/server typecheck`
also reached unrelated existing errors in
`server/src/modules/agent-lifecycle/__tests__/lifecycle.test.ts` for unsupported
`allowDuplicate` properties (lines 70, 418, and 428); it did not report an error
in this task's changed test file.

## Concerns

- The complete focused file remains non-green due to the five failures above;
  resolving them would require behavior/test work beyond the requested
  host-auth fixture isolation.
- Vitest emits the pre-existing Vite `configLoader: 'native'` deprecation
  warning during all runs.
