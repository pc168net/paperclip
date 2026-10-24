# Task 15 report: Final Role Profile correctness fixes

## Findings and root causes

1. Direct agent creation trusted `createInput.role` for the CEO/Profile guard.
   The direct route therefore accepted a Profile when the first agent omitted
   role and Zod defaulted it to `general`.
2. Profile adoption spans lifecycle database writes and managed-filesystem
   writes. The previous ordering recorded adoption before materialization, but
   did not compensate an instruction storage failure; a failed operation could
   retain a new agent/adoption with no applied Profile files.
3. The server adoption row exposes `appliedAt`, while the UI client and Agent
   detail read a nonexistent `createdAt` property.

## Implementation

- Direct `POST /companies/:companyId/agents` now checks the authoritative
  company agent roster when Profile input is present. The first roster member is
  treated as the CEO flow regardless of an omitted or forged role, matching
  `/agent-hires`.
- Added one Profile-application helper shared by direct creation and hires.
  It writes adoption provenance/activity, materializes through the existing
  managed-instructions service, and compensates any failure by removing the
  server-owned managed root and deleting the just-created agent plus its
  dependencies in a transaction. The agent/adoption never reaches the response
  on a failed Profile application. This deliberately does not claim a native
  database/filesystem transaction: compensation handles the cross-boundary
  failure path.
- Added a narrowly scoped injected instruction-service boundary for the route's
  controlled-fault integration test. Production continues to use the standard
  service. The fault test exercises actual database lifecycle/adoption state
  rather than mocking persistence.
- Renamed the UI adoption contract/display field from `createdAt` to
  `appliedAt`.

## RED → GREEN evidence

- **RED:** direct first-agent Profile creation with omitted role returned 201.
  The new regression expected 422 and failed before the roster guard.
- **RED:** the controlled instruction-materialization failure test failed before
  compensation because a Profile application could leave durable state after the
  filesystem boundary failed.
- **GREEN:** after the roster guard and compensation helper, the focused server
  test suite passed all 10 adoption tests, including the controlled fault path
  asserting only the bootstrap CEO remains and no adoption row remains.
- **GREEN:** the Agent Detail instruction suite passed with the corrected typed
  `appliedAt` contract.

## Verification

```sh
pnpm exec vitest run server/src/__tests__/agent-role-profile-adoption.test.ts
# 1 file, 10 tests passed

pnpm exec vitest run ui/src/pages/AgentDetail.instructions.test.tsx
# 1 file, 14 tests passed

pnpm exec tsc -p server/tsconfig.json --noEmit
# passed

pnpm --filter @paperclipai/ui typecheck
# passed

pnpm check:token-gates
# passed
```

The combined Profile service regression command also ran
`server/src/__tests__/agent-role-profiles.test.ts`. Two pre-existing path
validation assertions in that file currently expect 422 but receive the global
JSON parser's 400 for `C:/instructions.md` and a NUL-containing JSON key. This
Task does not alter Profile route validation or JSON parsing; the new adoption
suite passes independently.

## Files changed

- `server/src/routes/agents.ts`
- `server/src/__tests__/agent-role-profile-adoption.test.ts`
- `ui/src/api/agents.ts`
- `ui/src/pages/AgentDetail.tsx`
- `ui/src/pages/AgentDetail.instructions.test.tsx`

## Remaining concerns

- Compensation removes only the just-created agent's server-owned managed
  instruction root. It is restricted to Profile application after explicit
  bundle combinations have already been rejected, so it cannot remove an
  operator-selected external or pre-existing instruction location.
- The filesystem deletion and database delete remain separate operations by
  necessity. If database compensation itself fails, the route raises an
  aggregate error rather than reporting a false successful creation; operator
  recovery remains possible from the durable row.
- The two existing malformed-JSON Profile-service assertions described above
  remain outside this task's scope.

## Fix round 1: compensation failure ordering

### Root cause

The first compensation implementation awaited managed-root removal outside its
database-cleanup `try`. A removal failure therefore bypassed the rest of
compensation. Likewise, a database cleanup failure was reported only as an
aggregate error without documenting that the retained adoption could restore
the instruction state.

### Fix and recovery contract

- Root cleanup now runs inside the compensation decision. If it fails after
  adoption has committed, the newly created agent and adoption are deliberately
  retained. The adoption is the durable recovery record, and normal explicit
  Profile restore recreates the intended managed files.
- Database compensation runs only after root removal succeeds. If its
  transaction fails, the agent/adoption remain together for the same restore
  recovery path; the error explicitly directs that recovery rather than
  presenting the result as a successful cleanup.
- If adoption persistence itself failed, no Profile filesystem materialization
  ran. The implementation still attempts database compensation even when
  removing an empty root fails, because no durable adoption exists for that
  branch.
- Controlled fault boundaries exercise both cleanup edges with the real
  database, agent lifecycle data, adoption row, and restore API.

### RED → GREEN evidence

- **RED:** added a root-removal failure regression. Before the fix, the route
  still deleted the agent because it ignored the injected removal failure; the
  test could not find a recoverable adoption.
- **RED:** added a database-compensation failure regression. Before the fix,
  cleanup proceeded despite the injected database-compensation failure and the
  expected recoverable agent/adoption was absent.
- **GREEN:** `pnpm exec vitest run
  server/src/__tests__/agent-role-profile-adoption.test.ts` passed all 12 tests.
  Both failure orders retain the agent/adoption and prove the normal restore API
  can recover the Profile instructions.
- **GREEN:** `pnpm exec tsc -p server/tsconfig.json --noEmit` passed.
