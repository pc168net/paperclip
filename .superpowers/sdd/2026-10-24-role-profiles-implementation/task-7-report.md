# Task 7 report: hermetic managed AI-connection tests

## Root cause

`assertManagedAiProjectAuth` intentionally walks ancestors of `adapterConfig.cwd`
to reject project authentication settings that conflict with a managed connection.
When this test fixture omitted `cwd`, that production guard correctly fell back to
`process.cwd()`. Walking ancestors from this checkout reached the host-level
`/Users/bruce/.claude/settings.json`, where the host Claude authentication setting
caused `ai_connection_incompatible` failures. This was test-environment leakage;
the production ancestor scan is unchanged.

## RED evidence

After adding the focused regression but before adding a fixture execution root, I
ran:

```sh
pnpm exec vitest run server/src/__tests__/agent-hire-ai-connections.test.ts
```

Result: exit 1; **19 failed, 52 passed (71 total)**. The new test,
`does not inherit host Claude authentication from the fixture execution root`,
failed with `Project authentication settings conflict with the selected AI
connection` and `details.code: ai_connection_incompatible`, originating at
`assertManagedAiProjectAuth` in `server/src/services/ai-connection-runtime.ts`.
The other failures had the same incompatibility cause. No host configuration was
modified or masked.

## GREEN evidence

The fixture now creates an empty `executionRoot` inside its isolated temporary
home and supplies it as `adapterConfig.cwd` for fixture agents and adapter-test
probes. Direct managed-runtime probes use the same root through the test-only
`fixtureExecutionConfig` helper. The pool-harness-switch test deliberately clears
the fixture-only cwd before an agent-authenticated host-setting update, preserving
that test's existing authorization boundary.

Fresh focused verification:

```sh
pnpm exec vitest run server/src/__tests__/agent-hire-ai-connections.test.ts
```

Result: exit 0; **71 passed, 0 failed**. The brief referred to 70 tests; the
focused regression increases the current file's count to 71.

Additional narrow compile verification:

```sh
pnpm --filter @paperclipai/server typecheck
```

Result: exit 0.

`git diff --check` also completed with exit 0.

## Modified files

- `server/src/__tests__/agent-hire-ai-connections.test.ts`
  - Added the real managed Anthropic regression.
  - Added a fixture-owned empty execution root and applied it to fixture agents,
    adapter probes, and direct runtime probes.
- `.superpowers/sdd/2026-10-24-role-profiles-implementation/task-7-report.md`
  - This evidence report.

## Self-review

- Confirmed the production implementation file is not changed; its intentional
  ancestor scan and incompatible-project-auth behavior remain intact.
- The regression calls `prepareManagedAiRuntime` and asserts a real managed
  connection attribution rather than inspecting fixture implementation details.
- The test-owned execution root is removed with the existing temporary home in
  `afterAll`.
- Reviewed the diff and ran `git diff --check`.

## Concerns

- The focused Vitest command emits the repository's pre-existing Vite
  `configLoader: 'native'` future-compatibility warning and normal test runtime
  logs; neither is a test failure.
- Full-repository test/build commands were not run because this is a scoped
  test-fixture-only change; focused tests and server typecheck were run.
