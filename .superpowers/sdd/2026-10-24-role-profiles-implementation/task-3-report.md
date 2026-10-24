# Task 3 report: Agent adoption, diff, and explicit restore

## Implementation

- Extended agent creation input with optional `roleProfileId` and
  `roleProfileRevisionId`. These are consumed by the server and never persisted
  as agent fields, preserving `agents.role`.
- At creation, a board-selected non-CEO Profile revision is company-validated,
  copied into the new agent's existing managed instruction bundle, and recorded
  as a one-per-agent adoption with the exact copied managed paths. The adoption
  write and its `agent_role_profile.applied` activity record share a database
  transaction.
- Kept the no-Profile instruction path unchanged. CEO Profile application and
  any Profile selection for a CEO-role agent are rejected, so existing CEO
  defaults and role-driven behavior are not replaced.
- Added board-only, company-scoped adoption provenance and diff routes:
  - `GET /api/agents/:id/role-profile`
  - `GET /api/agents/:id/role-profile/diff?revisionId=<optional UUID>`
- Added confirmation-gated restore:
  - `POST /api/agents/:id/role-profile/restore`
  - body: `{ confirm: true, roleProfileRevisionId?: UUID }`
  - the diff returns per-path `added`, `changed`, `removed`, or `unchanged`
    state and both current/Profile text for confirmation UI.
- Restore only writes paths in the selected Profile revision or deletes paths
  that were recorded in the prior adoption manifest. It preserves unrelated
  files. Entry-file restores use the canonical instruction revision service;
  other managed files use the existing agent-file store. A restore updates the
  adoption metadata only after writes and adds `agent_role_profile.restored`
  activity.
- Archived Profiles remain readable for already-adopted provenance, diff, and
  restore, but cannot be newly selected for creation.

## TDD evidence

1. **RED — Profile creation adoption:** added an integration test creating a
   Profile with `AGENTS.md` and `SOUL.md`, then creating a general agent from
   it. Before implementation, it failed because the created agent retained the
   generic default `AGENTS.md` rather than `Research instructions`.
2. **GREEN — Profile creation adoption:** the focused adoption test passed after
   profile selection/materialization and adoption recording were implemented.
3. **RED — restore:** added the restore integration test after changing a
   Profile-managed `SOUL.md` and creating unrelated `notes.md`. Its first run
   failed with a 400 because the existing restore schema did not accept the
   required explicit confirmation field.
4. **GREEN — restore:** after the confirmation contract and restore path were
   implemented, the test passed and verified `SOUL.md` resets while `notes.md`
   remains unchanged.

## Verification

Passed:

```sh
pnpm exec vitest run server/src/__tests__/agent-role-profile-adoption.test.ts server/src/__tests__/agent-role-profiles.test.ts
# 2 files, 10 tests passed

pnpm exec tsc -p server/tsconfig.json --noEmit
# passed

git diff --check
# passed
```

The focused suite covers two-agent duplicate use (`allowDuplicate`), copied
files, preserved `general` role, diff visibility, explicit restore, and an
unrelated-file preservation regression.

I also ran the CEO/default-instruction regression suite
`agent-skills-routes.test.ts` with the focused tests. Its CEO/default cases
passed, but the file has three pre-existing failures in unrelated direct-hire
mock call assertions: each expects `mockAgentService.create` without the
already-present `allowDuplicate: false` third-argument property. The same
property is present in `HEAD` before this task. No change was made to that
unrelated suite.

The requested server package typecheck was run directly rather than through the
package script because its normal wrapper stops before TypeScript when Cargo is
unavailable.

## Files changed

- `packages/shared/src/validators/agent.ts`
- `packages/shared/src/validators/agent-role-profiles.ts`
- `server/src/services/agent-role-profiles.ts`
- `server/src/routes/agents.ts`
- `server/src/__tests__/agent-role-profile-adoption.test.ts`

## Self-review and concerns

- All Profile/revision/adoption reads use company IDs; profile selection rejects
  foreign or archived profiles. Board authorization gates provenance, diff, and
  restore. Mutations are activity logged.
- Profile selection is rejected for CEO agents and does not alter role,
  permissions, runtime configuration, or no-Profile behavior.
- Restore cannot delete the active managed entry file, matching the existing
  managed-instruction invariant. A Profile revision that omits that entry will
  receive a validation error before mutation.
- File writes necessarily use the existing filesystem-backed managed-instruction
  mechanisms. Restore metadata is recorded only after the per-file writes
  complete. A host filesystem failure during a multi-file restore can therefore
  leave a partial file restore but no advanced adoption revision; retry remains
  safe and the stored provenance continues to bound deletion authority.

## Review-fix addendum

### Root cause

Review identified three correctness gaps in the initial implementation:

1. Diff constructed its candidate path set from both `adoption.managedPaths`
   and the target revision's paths. A later Profile revision could therefore
   claim an independently created agent file.
2. Diff and restore delegated an omitted revision to the Profile service, where
   omission means latest revision, rather than pinning to the agent's recorded
   adoption revision.
3. Creation materialized files before the adoption database transaction. A
   database failure on that later transaction could leave copied files with no
   restoration authority manifest.

### Fixes

- Diff and restore now enumerate **only** `adoption.managedPaths`. A target
  revision may replace or omit those recorded paths, but cannot add new restore
  authority. Omitted target content is still shown as a removal, so deletion
  remains limited to prior Profile-owned paths.
- Diff and restore now explicitly pass `adoption.appliedRevisionId` when the
  request omits a revision. Another Profile revision requires the caller to
  name its ID.
- Agent creation now persists the adoption row and its activity record before
  the managed-bundle filesystem operation. Both database writes remain one
  transaction. If they fail, materialization is never attempted; if filesystem
  materialization fails afterward, durable adoption provenance remains to bound
  and recover the instruction state. Profile selection with an explicit bundle
  is rejected so provenance cannot be recorded for a bundle that was deliberately
  not materialized.

### Review-fix RED/GREEN evidence

- **RED:** Added a test where an agent adopted revision 1, created `notes.md`,
  and a later Profile revision added `notes.md`. The old diff exposed
  `notes.md` as changed and restore would overwrite it.
- **RED:** Added a test where revision 2 changed `AGENTS.md`. The old default
  diff returned revision 2 instead of the agent's adopted revision 1.
- **GREEN:** `pnpm exec vitest run
  server/src/__tests__/agent-role-profile-adoption.test.ts` passed all 4 tests
  after limiting candidates to the stored manifest, pinning omitted revisions,
  and reordering durable adoption before materialization.
