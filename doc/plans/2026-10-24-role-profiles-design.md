# Role Profiles design

**Date:** 2026-10-24  
**Status:** Implemented — Task 6 verification recorded 2026-10-24; live browser acceptance remains unexecuted because this environment lacks the Rust/Cargo toolchain required for the full build.

## Intent

Let a company maintain reusable, versioned initial instruction bundles for
agents. A board operator selects a Role Profile while creating an agent, and
Paperclip copies the Profile's managed files into that agent's own instruction
bundle. The agent can then evolve independently. An operator can later compare
the agent with the Profile revision it adopted and explicitly restore the
Profile-managed files.

The feature makes role-like templates useful without changing the existing
`agents.role` contract, particularly the established `ceo` governance behavior.

## Goals

- Add **Role Profiles** to the company-level **ORG** navigation alongside
  Agents, Skills, Connectors, and Audit.
- Seed a visible, read-only **CEO** system Profile. It is informational only:
  it must not change existing CEO agent instructions, permissions, API behavior,
  or governance checks.
- Seed editable company Profiles for the existing non-CEO role labels:
  CTO, CMO, CFO, Security, Engineer, Designer, PM, QA, DevOps, Researcher, and
  General. Operators can also create additional Profiles.
- Let a Profile own a named instruction-file manifest, initially supporting
  `AGENTS.md`, `SOUL.md`, and other safe relative instruction files.
- Version Profile contents immutably. Every change produces a Profile revision.
- Let agent creation select a Profile and copy its current revision as the
  agent's initial managed files.
- Permit any number of active agents to select the same non-CEO Profile. Show a
  clear confirmation before a duplicate is created rather than blocking it.
- Show the Profile source and adopted revision on an agent. Let operators see a
  file diff and explicitly restore Profile-managed files from a chosen Profile
  revision.
- Preserve files and configuration outside the Profile's owned manifest.
- Audit all Profile mutations, applications, and restores.

## Non-goals

- Do not replace, rename, or alter the existing `agents.role` field.
- Do not change any `agent.role === "ceo"` authorization, assignment,
  workspace-runtime, instructions, or onboarding behavior.
- Do not make a Profile edit automatically modify agents that previously adopted
  it.
- Do not use Profiles to change Harness, Connection, Model, Tools, Permissions,
  Secrets, budgets, reporting lines, tasks, or runtime configuration in the
  first release.
- Do not remove an agent's independently created files, task data, run history,
  or other non-Profile-managed resources during restore.

## Current baseline

- `agents.role` uses a fixed role enum. Only `ceo` has hard-coded product
  behavior: a CEO instruction bundle, core default skills when supported, and
  several governance/authorization paths.
- All non-CEO roles currently receive the same default `AGENTS.md`; they have
  no role-specific built-in `SOUL.md`, Harness, tool, model, or permission
  behavior.
- Instructions already have per-agent revision/head/working-copy persistence.
  They are materialized into each agent's managed instruction bundle.
- The new-agent UI currently silently sends `general` for every agent after the
  first. The hire guard rejects duplicate active roles unless the request uses
  `allowDuplicate=true`, but the standard new-agent UI does not expose either a
  role selector or that confirmation. This makes a second general agent
  impossible through the normal UI.

## Approaches considered

### A. Independent Role Profiles over existing roles — selected

Add a company-scoped Profile model and an optional reference from an agent to
the Profile/revision it adopted. Keep `agents.role` and all CEO checks intact.

**Why selected:** It adds operator-controlled defaults without conflating a
mutable template with governance authority. It preserves compatibility with
existing agents, APIs, team templates, role-targeted skill policies, and CEO
authorization.

### B. Split `agents.role` into governance role and mutable role Profile

Introduce a new governance field for CEO authority and redefine `role` as a
mutable Profile selection.

**Rejected:** This touches every current `role` read, policy, import/export,
and authorization boundary. It is not required to solve reusable initial
instructions.

### C. Live-linked role templates

Make Profile edits automatically rewrite all agents using that Profile.

**Rejected:** It can overwrite intentional agent/operator changes and creates
surprising runtime changes. Explicit application and restore are safer and
auditable.

## Proposed data model

All rows are company-scoped. Profile content is stored as revisions rather than
as mutable files.

### `agent_role_profiles`

- `id` UUID primary key
- `company_id` UUID, required
- `key` text, stable company-unique machine key
- `name` text, operator-facing display name
- `description` text nullable
- `kind` enum/text: `system_ceo`, `seeded`, `custom`
- `archived_at` timestamp nullable
- `created_by_user_id` text nullable
- timestamps

The system CEO Profile is created/read on demand or seeded with `kind` set to
`system_ceo`; mutation and archive routes reject it. Its contents are a
read-only representation of the existing CEO default bundle, not a new source
of truth for CEO agents.

### `agent_role_profile_revisions`

- `id` UUID primary key
- `company_id`, `profile_id`
- `revision_number` integer, unique per Profile
- `managed_files` JSON object mapping safe relative paths to text contents
- `manifest` JSON list of managed paths, ordered deterministically
- `created_by_user_id` / `created_by_agent_id` nullable
- `change_summary` text nullable
- `created_at`

Only relative, normalized paths permitted by the existing managed-instructions
path policy are valid. No file may escape the managed instruction root.

### Agent adoption metadata

Store optional Profile adoption metadata with the agent instruction bundle (or
in a small first-class company/agent relation if lifecycle queries require it):

- `profile_id`
- `applied_revision_id`
- `applied_at`
- `managed_paths`

This records provenance, not inheritance. The metadata tells diff/restore
exactly which files the Profile owns for that agent. It must not change
`agents.role`.

## Lifecycle and semantics

### Seeded Profiles

When Role Profiles are first opened or an agent is created using the feature,
ensure the company has seeded non-CEO Profiles matching the existing role
labels. These are editable and can be archived only when no policy requires
them. The CEO Profile is always visible and read-only.

Seeding must be idempotent and must not modify existing agents.

### Create or edit Profile

An operator creates or edits a Profile through ORG → Role Profiles. Saving an
editable Profile creates a new immutable revision and advances its current
revision pointer. Profile edits never update adopted agents automatically.

### Create agent with Profile

The new-agent flow shows Profile selection after the agent name. It previews
the managed files that will be copied. The create request includes the selected
Profile/revision.

The standard role remains `general` for compatibility unless another existing
flow explicitly chooses a role. If an active agent already uses the selected
Profile (or the request's role would otherwise trigger the legacy duplicate
guard), show a confirmation dialog. Its confirmed create request sends
`allowDuplicate: true`. The server remains the enforcement point: it only
accepts duplication after this explicit flag.

### Agent modifications

After creation, the agent and operator may modify its instructions through the
existing per-agent instruction workflow. That changes the agent's own revisions
only, not the Profile revision.

### Diff

The Agent detail page shows the adopted Profile name, revision, apply time, and
the files currently managed by that adoption. "View differences" compares the
agent's current managed files against a selected Profile revision. It reports:

- added, changed, and removed Profile-managed files;
- files that would be overwritten or deleted by restore;
- a no-change state.

### Restore Profile initial values

Restore is an explicit confirmation flow. The operator selects a Profile
revision, views the diff, and confirms. Paperclip then replaces only the
Profile-managed paths recorded in the agent adoption metadata. It may delete a
previously Profile-managed path only when the confirmation diff shows that
deletion. It preserves every other agent instruction file and every non-
instruction resource. The restore creates a normal agent instruction revision,
updates adoption metadata to the selected Profile revision, and writes activity
logs.

## UI

### ORG navigation

Add **Role Profiles** after Audit in the ORG group.

### Role Profiles index/detail

- List Profile name, system/seeded/custom state, current revision, managed-file
  summary, and adopted-agent count.
- CEO appears as a locked read-only row. It explains that existing CEO behavior
  remains unchanged.
- Editable Profile detail supports name, description, managed-file editing,
  revision history, and archive where allowed.
- The UI does not expose internal ids or implementation details by default.

### New Agent flow

- Add Profile selection and initial-file preview.
- Show a duplicate-use confirmation instead of a hard dead-end.
- Keep current Harness, Connection, Tools, Permissions, and other agent setup
  steps unchanged.

### Agent detail

- Add a Profile provenance section near instructions/configuration.
- Show Profile name, adopted revision, apply time, managed-file status, and
  actions to inspect diff or restore.
- Existing CEO profile and instruction editing surfaces remain unchanged.

## API and authorization

- Add company-scoped list/create/update/archive/read-revision endpoints for
  Role Profiles.
- Add a read-only endpoint/representation for the system CEO Profile.
- Extend agent create/update flows with optional Profile application input.
- Add agent/Profile provenance, diff, and restore endpoints.
- Board/company-access authorization applies to Profile management; agent actors
  do not gain authority to mutate Profiles merely by adopting one.
- All mutations perform company-boundary checks and write activity-log events.
- Existing agent creation APIs remain compatible when no Profile is supplied.

## Compatibility and migration

- Preserve all existing `agents.role` values and API fields.
- Preserve existing CEO behavior exactly; no migration rewrites CEO agents.
- Do not attach Profiles to existing agents automatically. Operators opt in by
  applying a Profile, avoiding fabricated provenance.
- Keep old create clients working. They continue to create a general agent;
  their duplicate behavior remains server-controlled. The board UI gains the
  explicit confirmation path.
- The database migration adds new tables/relations only. It does not alter or
  reinterpret historical instruction revisions.

## Verification plan

### Database/shared/server

- Migration and company-scoping tests for Profile, revision, archive, and
  system-CEO immutability.
- Validation tests for duplicate revision numbers, malformed/escaping file
  paths, and empty manifests.
- Authorization tests for cross-company reads/writes and agent-vs-board access.
- Agent creation tests for Profile copy, duplicate confirmation, and unchanged
  legacy create behavior.
- Diff/restore tests proving only recorded managed paths change, agent-specific
  files survive, and restore creates instruction/activity revisions.
- CEO regression tests proving existing role-driven instructions, skills,
  permissions, task assignment, and workspace authority do not change.

### UI

- Role Profile index/detail and CEO lock stories/tests.
- New-agent Profile selection, duplicate confirmation, and API payload tests.
- Agent Profile provenance, diff, and restore confirmation tests.
- Run `pnpm check:token-gates` for UI changes.

### Manual acceptance

1. Create a Researcher Profile with custom `AGENTS.md` and `SOUL.md`.
2. Create two agents from it after accepting the duplicate-use confirmation.
3. Modify one agent's `AGENTS.md`; verify the other and the Profile stay
   unchanged.
4. Inspect diff and restore the modified agent; confirm only Profile-managed
   files reset.
5. Confirm an existing CEO still has its pre-feature behavior and the CEO
   Profile cannot be edited.

**2026-10-24 verification status:** The corresponding server and UI acceptance
coverage passed in a focused run (30 tests across four files), including
duplicate Profile adoption, managed-path-only restore, the duplicate-confirmation
UI, and the read-only CEO Profile. A live browser walkthrough of these five
steps was not run: `pnpm build` cannot complete in this environment because the
Runner's native build requires `cargo`, which is not installed. This automated
evidence does not replace the remaining interactive acceptance check.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Profile restore overwrites agent work | Diff + explicit confirmation; strict recorded managed-path allowlist |
| Mutable Profiles alter CEO governance | CEO Profile is informational/read-only; existing CEO code paths are untouched |
| Role/Profile terminology confuses operators | Label Profile separately and explain it is an initial configuration template |
| Cross-company data leakage | Company-scoped relations, routes, and tests |
| Existing instruction revisions become inconsistent | Do not rewrite history; restore produces ordinary new per-agent instruction revisions |

## Open implementation choices

- Whether Profile adoption provenance belongs in a first-class relation from the
  first release or in existing instruction-bundle metadata. Favor a first-class
  relation if list/count/diff queries become complex; favor metadata only if it
  can preserve company scoping, revision integrity, and query clarity.
- The first release should support text instruction files only. Binary assets,
  remote includes, and live template interpolation are explicitly deferred.
