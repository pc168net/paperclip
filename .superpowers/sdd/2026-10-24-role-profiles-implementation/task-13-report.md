# Task 13 report — residual AI-connection contract coverage and adoption atomicity

Date: 2026-10-24

## Root causes

1. Two reconnect tests and the connection guide still expected routing endpoints
   to be immutable. The active production contract preserves the connection and
   grant identity, saves the changed routing endpoint, and invalidates verified
   deployments for re-verification.
2. `putConnectionInstalls` always opened its own transaction. The inline
   connection-intent completion path needs the install to use its already-open
   completion transaction so the agent binding, install, and final interaction
   resolution have one rollback boundary.
3. The restricted shared-connection creation fixture reached duplicate-role
   enforcement before its authorization assertions. Its intentionally repeated
   `general` role lacked the explicit confirmation the product requires.
4. Test fixtures reused inferred reconnect credentials. The deployment fixture
   and the inline/standard adoption parameter cases now use distinct credentials
   so they cannot select an earlier same-company connection.

## Changes

- Added an optional caller transaction to `putConnectionInstalls`; it performs
  its writes directly on that transaction when supplied and retains its existing
  standalone transaction behavior otherwise.
- Passed the connection-intent completion transaction to both AI and general
  connection-install paths.
- Updated routing tests to assert persisted routing, stable IDs/access, and
  stale verified deployments. The JSONB case changes routing only after a
  credential rotation, proving routing alone invalidates deployment verification.
- Kept and strengthened inline adoption rollback coverage: the inline fixture
  first proves no install exists, then a trigger fails final interaction
  resolution and asserts no binding, install, or interaction state persists.
- Added `allowDuplicate: true` to the intentional duplicate-role fixture and
  isolated reconnect credentials/routing used by order-sensitive fixtures.
- Updated AI connection documentation with the routing-change/re-verification
  contract.

## RED → GREEN evidence

- **RED:**
  `pnpm exec vitest run server/src/__tests__/ai-connections.test.ts --reporter=dot --maxWorkers=1 --no-file-parallelism`
  reported **119 passed, 4 failed**: two obsolete routing-retention assertions,
  inline adoption persistence, and duplicate-role fixture masking.
- **GREEN:** the same required focused command reported **123 passed, 0 failed**.
- Focused inline adoption regression:
  `pnpm exec vitest run server/src/__tests__/ai-connections.test.ts --reporter=dot --maxWorkers=1 --no-file-parallelism -t 'validates runner account adoption'`
  reported **2 passed**.

## Files

- `server/src/services/tool-access.ts`
- `server/src/services/connection-intents.ts`
- `server/src/__tests__/ai-connections.test.ts`
- `doc/connections/AI-CONNECTIONS.md`

## Self-review

- The provided transaction is used only when explicitly supplied; all existing
  callers retain the previous standalone transaction behavior.
- Both connection-intent installation branches pass the outer transaction.
- Routing assertions check stored state and deployment state rather than only a
  service return value.
- No project-auth ancestor-scan or Task 11 fixture isolation code was changed.
- `git diff --check` passed.

## Tests

- PASS: focused `ai-connections.test.ts`, one worker and no file parallelism —
  123/123.
- PASS: `pnpm --filter @paperclipai/server typecheck`.
- LIMITATION: `pnpm test` was started and exceeded the 240-second harness
  timeout while the unrelated general-server suite was still running; it did not
  produce a final pass/fail summary. Its output contained expected synthetic
  warning/error logs from chat-channel failure-path tests before timeout.

## Concerns

- The broad Vitest suite needs a longer-running CI/local invocation for final
  repository-wide confirmation. No focused regression or typecheck failure
  remains.

## Fix round 1 — transaction-scoped install activity

### Root cause and change

`putConnectionInstalls` performed install/profile writes using a supplied caller
transaction, but wrote each `tool_connection.install_access_extended` activity
through its captured root database client. An outer rollback could therefore
remove the install and binding while retaining a false activity record.

The activity write now uses the supplied transaction when one exists; standalone
callers retain the root database client after their internal transaction commits.

### RED → GREEN evidence

- **RED:**
  `pnpm exec vitest run server/src/__tests__/ai-connections.test.ts --reporter=dot --maxWorkers=1 --no-file-parallelism -t 'rolls back non-AI install access activity'`
  failed because `tool_connection.install_access_extended` remained after a
  forced rollback of the supplied transaction.
- **GREEN:** the same targeted command passed. The regression uses a non-AI
  Sentry connection intent, asserts that both the explicit caller rollback and
  final interaction-resolution failure leave no install, profile binding, or
  access-extension activity, then completes successfully and asserts exactly one
  access-extension activity record.
- **Focused suite:**
  `pnpm exec vitest run server/src/__tests__/ai-connections.test.ts --reporter=dot --maxWorkers=1 --no-file-parallelism`
  passed **124/124**.
- **Typecheck:** `pnpm --filter @paperclipai/server typecheck` passed.

### Additional fixture stabilization

The deployment reconnect fixture now removes its temporary reader grants before
reconnecting the explicitly selected organization connection. This prevents an
unspecified row order from selecting a user grant for the same connection and
wrongly reporting an ownership transition.
