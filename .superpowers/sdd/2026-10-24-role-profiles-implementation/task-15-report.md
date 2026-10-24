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
