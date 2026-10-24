# Role Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add company-scoped, versioned instruction Role Profiles that may be selected at agent creation and explicitly restored without changing existing roles or CEO behavior.

**Architecture:** Profile rows own immutable content revisions; a one-per-agent adoption row records the profile revision and exact managed paths copied to that agent. A service seeds editable non-CEO role profiles on demand, exposes an informational immutable CEO profile, validates paths through the existing instruction path policy, and uses the existing agent instruction file API for profile application and restore. Board-only HTTP routes and a compact ORG UI compose those contracts.

**Tech Stack:** PostgreSQL/Drizzle, Express, Zod, React 19, TanStack Query, Tailwind/shadcn.

**Spec:** `doc/plans/2026-10-24-role-profiles-design.md`

## Global Constraints

- Do not replace, rename, or alter `agents.role`.
- Do not change any `agent.role === "ceo"` authorization, assignment, workspace-runtime, instructions, or onboarding behavior.
- CEO Profile is an informational read-only system entry; existing CEO agent behavior remains unchanged.
- Profile edits never automatically modify adopted agents.
- Profile restore overwrites or deletes only the adoption row's recorded managed files; it preserves all other agent files and resources.
- Every persistence read/write is company scoped; mutations write activity-log entries.
- Use `instructionPath` validation for every profile file path and `pnpm db:generate` for the migration.
- UI changes use design tokens only and must pass `pnpm check:token-gates`.

## Review Focus

- Profile id from another company must never be usable to create, diff, restore, or count an agent.
- A malicious `../` or absolute managed-file path must return validation failure before any filesystem write.
- Restoring a revision that removes a profile-owned file must delete that file but retain unrelated agent files.
- Editing a Profile revision after two agents adopt it must leave their instruction bytes unchanged.
- Existing CEO creation with no Profile must continue to materialize its current CEO instruction bundle.

---

### Task 1: Role Profile persistence and shared contracts

**Files:**
- Create: `packages/db/src/schema/agent_role_profiles.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/shared/src/validators/agent-role-profiles.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/validators/agent-role-profiles.test.ts`

**Interfaces:**
- Produces `agentRoleProfiles`, `agentRoleProfileRevisions`, `agentRoleProfileAdoptions`; shared create/update/apply schemas and public Profile types.

- [ ] Write failing shared validation tests for a non-empty normalized file manifest and rejected `../escape.md` paths.
- [ ] Run the test to verify it fails because Role Profile validators do not exist.
- [ ] Implement the shared schemas/types and three company-scoped Drizzle tables with a one-adoption-per-agent constraint and revision-number uniqueness.
- [ ] Run `pnpm --filter @paperclipai/shared test -- agent-role-profiles` to verify it passes.
- [ ] Generate migration with `pnpm db:generate`, inspect it, retain only five newest snapshots, and run `pnpm --filter @paperclipai/db check:migrations`.
- [ ] Commit persistence and shared contracts.

### Task 2: Profile service and board API

**Files:**
- Create: `server/src/services/agent-role-profiles.ts`
- Create: `server/src/routes/agent-role-profiles.ts`
- Modify: `server/src/routes/index.ts`
- Modify: `server/src/routes/openapi.ts`
- Test: `server/src/__tests__/agent-role-profiles.test.ts`

**Interfaces:**
- Consumes Task 1 tables and schemas.
- Produces board-scoped profile list/create/update/archive/revision endpoints and `ensureSeededProfiles(companyId)`.

- [ ] Write a failing route test that lists an immutable CEO entry plus editable seeded non-CEO Profiles for one company, and proves another company cannot read them.
- [ ] Run the test to verify it fails because the route is missing.
- [ ] Implement idempotent seeding, immutable revision writes, system-CEO mutation rejection, and company-bound board routes with activity logging.
- [ ] Run the focused server test to verify it passes.
- [ ] Commit service and API.

### Task 3: Agent adoption, diff, and explicit restore

**Files:**
- Modify: `packages/shared/src/validators/agent.ts`
- Modify: `server/src/routes/agents.ts`
- Modify: `server/src/services/agent-role-profiles.ts`
- Test: `server/src/__tests__/agent-role-profile-adoption.test.ts`

**Interfaces:**
- Consumes Profile service from Task 2 and existing managed instruction APIs.
- Produces optional `roleProfileId`/`roleProfileRevisionId` create input; agent profile provenance, diff, and restore endpoints.

- [ ] Write a failing integration test showing profile creation copies two files into a new general agent while preserving its role, and a second agent may use the same Profile with `allowDuplicate`.
- [ ] Run it to verify it fails because profile application does not exist.
- [ ] Implement server-side profile selection, company/revision validation, atomic adoption recording, and existing-bundle materialization without changing the no-Profile default flow.
- [ ] Add a failing test that changes a profile-owned file and an unrelated agent file, then restores and expects only the profile-owned file to reset.
- [ ] Run it to verify it fails because restore does not exist.
- [ ] Implement provenance read, per-file diff, confirmation-ready restore, path deletion limited to previously managed paths, and activity logging.
- [ ] Run focused adoption tests and existing CEO/default-instruction regression tests.
- [ ] Commit adoption and restore behavior.

### Task 4: Role Profile UI and API client

**Files:**
- Create: `ui/src/api/agentRoleProfiles.ts`
- Create: `ui/src/pages/RoleProfiles.tsx`
- Create: `ui/src/pages/RoleProfiles.test.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes Task 2 HTTP contracts.
- Produces `/role-profiles` ORG navigation and list/detail editing UI.

- [ ] Write a failing UI test that renders the CEO entry as read-only and lets a board user select an editable seeded Profile.
- [ ] Run it to verify it fails because the page/route is missing.
- [ ] Implement Profile list/detail composition with revision summary, editable file manifest, and CEO compatibility explanation using existing primitives/tokens.
- [ ] Add ORG navigation after Audit and update sidebar tests.
- [ ] Run focused UI tests and `pnpm check:token-gates`.
- [ ] Commit Profile UI.

### Task 5: Agent-creation selection and provenance/restore UI

**Files:**
- Modify: `ui/src/components/new-agent/NewAgentSetup.tsx`
- Modify: `ui/src/pages/AgentDetail.tsx`
- Modify: `ui/src/api/agents.ts`
- Test: `ui/src/components/new-agent/NewAgentSetup.test.tsx`
- Test: `ui/src/pages/AgentDetail.instructions.test.tsx`

**Interfaces:**
- Consumes Task 3 adoption/diff/restore endpoints and Task 4 API client models.
- Produces selected Profile payload, duplicate-use confirmation, provenance, diff, and restore controls.

- [ ] Write a failing setup test that selects a Profile and requires an explicit duplicate confirmation before sending `allowDuplicate: true`.
- [ ] Run it to verify it fails because no Profile control exists.
- [ ] Implement Profile selection/file preview and duplicate confirmation while leaving harness, connection, tools, and permission setup unchanged.
- [ ] Write a failing Agent Detail test that shows Profile revision provenance and opens a restore confirmation describing only managed paths.
- [ ] Run it to verify it fails because provenance/restore controls are missing.
- [ ] Implement provenance, diff, and restore UI with contextual error states.
- [ ] Run focused UI tests and `pnpm check:token-gates`.
- [ ] Commit agent UI.

### Task 6: End-to-end verification and documentation

**Files:**
- Modify: `doc/plans/2026-10-24-role-profiles-design.md`
- Modify: `doc/plans/2026-10-24-role-profiles-implementation.md`

- [x] Run `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`, and `pnpm check:token-gates`.
  `pnpm check:token-gates` passed. `pnpm -r typecheck` and `pnpm build` both
  reached the Runner Rust stage but could not finish because `cargo` is not
  installed. `pnpm test:run` exceeded the 20-minute local bound before a final
  summary; it had reported 18 failures in the unrelated
  `agent-hire-ai-connections.test.ts` file. See the Task 6 report for exact
  command evidence.
- [x] Exercise acceptance behavior with focused automated coverage:
  `pnpm exec vitest run server/src/__tests__/agent-role-profile-adoption.test.ts ui/src/pages/RoleProfiles.test.tsx ui/src/components/new-agent/NewAgentSetup.deployment.test.tsx ui/src/pages/AgentDetail.instructions.test.tsx`
  passed 30 tests. It covers adoption by two agents after confirmation,
  managed-path-only restore, duplicate-confirmation UI, and read-only CEO
  Profile. The live browser walkthrough remains unexecuted because the missing
  Rust toolchain blocks the required complete build.
- [x] Update design/implementation status and record verification limitations.
- [x] Commit verification documentation.

## Task 6 verification status (2026-10-24)

The Role Profiles-focused acceptance coverage and token gates are green. Full
repository verification is incomplete in this environment: install Rust/Cargo
and rerun typecheck/build, then rerun the full test suite to completion and
perform the documented browser walkthrough before treating this as full
end-to-end acceptance.
