# Task 12 report — isolate workspace-runtime Git fixture default branch

## Status

Implemented the requested test-only fixture isolation. No production
workspace-runtime or ref-resolution code changed.

## Changes

- `createTempRepo(defaultBranch)` now runs `git init -b <defaultBranch>` before
  creating its first commit.
- Added a regression that sets an isolated ambient Git configuration with
  `init.defaultBranch=main`, creates `createTempRepo("master")`, and verifies
  the repository has exactly the `master` branch.

## TDD evidence

### RED

Command:

```sh
pnpm exec vitest run server/src/__tests__/workspace-runtime.test.ts \
  -t 'creates only the requested master branch when Git defaults to main' \
  --pool=forks --maxWorkers=1
```

Result: exit 1; 1 failed, 180 skipped. The branch assertion received
`main\nmaster` instead of `master`, demonstrating that the previous `git init`
followed by `git checkout -B master` retained the ambient-default branch.

### GREEN

The same command after changing only the test helper initialization: exit 0;
1 passed, 180 skipped.

## Focused-file verification

Command (without `GIT_CONFIG_NOSYSTEM` or other host-Git suppression):

```sh
pnpm exec vitest run server/src/__tests__/workspace-runtime.test.ts \
  --pool=forks --maxWorkers=1
```

Result: exit 0; 181 passed (the prior 180 tests plus the new regression) in
108.98 seconds.

## Additional verification

`git diff --check` exited successfully.

Attempted the repository-wide Vitest command:

```sh
pnpm test
```

It did not finish before the 20-minute command timeout. The captured output
ended without a Vitest summary or assertion failure, so it is inconclusive and
is not used as passing evidence.

## Concerns

- Vitest emits the existing Vite `configLoader: 'native'` deprecation warning
  on focused runs.
- Repository-wide `pnpm test` needs a separate, longer-budget run if full-suite
  evidence is required; this task's complete focused suite is green.
