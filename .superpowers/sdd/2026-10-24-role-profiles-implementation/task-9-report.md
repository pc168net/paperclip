# Task 9 report: isolate Claude default-model test

## Change

Updated only `server/src/__tests__/claude-local-execute.test.ts`. The
parameterized default-model CLI execution test now explicitly supplies
`ANTHROPIC_MODEL: ""` in its `config.env`, alongside its capture-path fixture.
This isolates the fallback-model assertion from the host environment without
changing adapter runtime precedence.

## TDD evidence

RED, before the test isolation change:

```sh
ANTHROPIC_MODEL=claude-sonnet-4-6 pnpm exec vitest run server/src/__tests__/claude-local-execute.test.ts --reporter=verbose
```

Result: 1 failed file; 3 failed and 29 passed tests. The `undefined`, empty,
and whitespace model rows expected `claude-opus-5` but received the host
override `claude-sonnet-4-6`.

GREEN, after the change:

```sh
env -u ANTHROPIC_MODEL pnpm exec vitest run server/src/__tests__/claude-local-execute.test.ts --reporter=dot
ANTHROPIC_MODEL=claude-sonnet-4-6 pnpm exec vitest run server/src/__tests__/claude-local-execute.test.ts --reporter=dot
```

Result: both commands passed: 1 passed file, 32 passed tests (16.40s and
16.53s respectively).

## Wider verification

`pnpm test` was started but exceeded the 20-minute command timeout before a
suite summary was emitted, so it is not a passing result. The output contained
expected service-test warning/error logging before timeout; Task 9 did not
modify those paths.

## Scope and concerns

- No production adapter code was changed.
- `server/src/__tests__/workspace-runtime.test.ts` was already modified in the
  worktree and was not changed or included in this task's commit.
- Vitest emits the existing Vite `configLoader: 'native'` future-warning during
  focused runs; focused test outcomes are green.
