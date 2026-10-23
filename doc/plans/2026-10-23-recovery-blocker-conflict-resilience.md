# Recovery Blocker-Conflict Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contain a recovery-time blocker-cycle validation failure as a board-visible manual hold so it cannot stop server startup or repeatedly retry a rejected dependency write.

**Architecture:** Keep `issuesSvc.update()` and transactional cycle validation authoritative. At the recovery boundary, classify only the exact 422 cycle error, atomically escalate the current action using existing `escalated`/`blocked` vocabulary, and skip that marked hold on later sweeps. Existing recovery UI already renders escalated actions, so no new UI or schema state is needed.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, embedded PostgreSQL test fixture, Express startup harness.

**Spec:** `doc/plans/2026-10-23-recovery-reconciliation-resilience-design.md`

## Global Constraints

- Preserve company-scoped issue relations and never bypass `syncBlockedByIssueIds()` or weaken acyclic-graph validation.
- Never auto-delete/rewrite relations, replay provider work, or resolve the native execution-reconciliation holds for `TWS-41` and `TWS-36`.
- Reuse existing recovery vocabulary: `status: "escalated"`, `outcome: "blocked"`, and `resolutionNote: "blocker_graph_conflict"`; no migration or UI enum additions.
- Only `HttpError(422, "Blocking relations cannot contain cycles")` is contained. Other validation, database, and authorization errors must still reject.
- Follow `rules/heartbeat-execution-boundaries.mdc` for heartbeat/recovery changes and tests.

## Review Focus

- **Exact error classification:** a different 422 rethrows; Task 1 tests exact status/message matching.
- **Graph integrity:** rejected recovery writes add no relation or reverse edge; Task 2 uses a real cycle fixture.
- **Concurrency:** another actor resolving an action first cannot be overwritten; Task 1 tests conditional update behavior.
- **Repeat scheduler ticks:** an escalated graph-conflict hold stays visible but makes no further write; Task 2 tests a second sweep.
- **Startup availability:** contained counts are reported without suppressing unrelated startup errors; Task 3 tests the startup harness.

---

## File Structure

- `server/src/services/recovery/blocker-graph-conflict.ts` — exact typed error classifier.
- `server/src/services/recovery/blocker-graph-conflict.test.ts` — classifier regressions.
- `server/src/services/issue-recovery-actions.ts` — conditional promotion to board-visible manual hold.
- `server/src/__tests__/issue-recovery-actions.test.ts` — integration fixture for the rejected relation write and repeat sweep.
- `server/src/services/recovery/service.ts` — containment and aggregate count.
- `server/src/index.ts` — startup warning includes contained count.
- `server/src/__tests__/server-startup-feedback-export.test.ts` — startup warning/readiness regression.

### Task 1: Add Exact Classification and Atomic Action Escalation

**Files:**
- Create: `server/src/services/recovery/blocker-graph-conflict.ts`
- Test: `server/src/services/recovery/blocker-graph-conflict.test.ts`
- Modify: `server/src/services/issue-recovery-actions.ts:36-79, 539-588`
- Test: `server/src/__tests__/issue-recovery-actions.test.ts:141-229`

**Interfaces:**
- Produces: `isBlockingRelationCycleError(error: unknown): boolean`.
- Produces: `issueRecoveryActionService(db).escalateForBlockerGraphConflict(input): Promise<IssueRecoveryAction | null>` where `input` contains `companyId`, `sourceIssueId`, `actionId`, and `blockedByIssueIds`.
- Consumed by: `recoveryService()` in Task 2.

- [ ] **Step 1: Write failing classifier tests**

```ts
expect(isBlockingRelationCycleError(
  new HttpError(422, "Blocking relations cannot contain cycles"),
)).toBe(true);
expect(isBlockingRelationCycleError(
  new HttpError(422, "Blocked-by issues must belong to the same company"),
)).toBe(false);
expect(isBlockingRelationCycleError(
  new Error("Blocking relations cannot contain cycles"),
)).toBe(false);
```

- [ ] **Step 2: Run the classifier test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- blocker-graph-conflict.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `isBlockingRelationCycleError`**

In `server/src/services/recovery/blocker-graph-conflict.ts`, import `HttpError` from `server/src/errors.ts`. Return true only for an `HttpError` with status `422` and the exact cycle-validation message; do not use a substring match.

- [ ] **Step 4: Write a failing action-escalation service test**

Seed an active action and assert that the new service method returns:

```ts
expect(updated).toMatchObject({
  status: "escalated",
  ownerType: "board",
  ownerAgentId: null,
  ownerUserId: null,
  outcome: "blocked",
  resolutionNote: "blocker_graph_conflict",
  wakePolicy: null,
  monitorPolicy: null,
  evidence: expect.objectContaining({
    blockerGraphConflict: expect.objectContaining({ reason: "blocker_graph_conflict" }),
  }),
});
expect(await service.escalateForBlockerGraphConflict(input)).toBeNull();
```

- [ ] **Step 5: Run the focused service tests to verify failure**

Run: `pnpm --filter @paperclipai/server test -- blocker-graph-conflict.test.ts issue-recovery-actions.test.ts`

Expected: FAIL because neither public interface exists.

- [ ] **Step 6: Implement `escalateForBlockerGraphConflict`**

Add an exported input type and a conditional `UPDATE` scoped to company, source issue, action ID, and `status = "active"`. Set `status: "escalated"`, board ownership, `outcome: "blocked"`, `resolutionNote: "blocker_graph_conflict"`, clear wake/monitor policies, and merge `evidence.blockerGraphConflict = { reason, blockedByIssueIds, detectedAt }`. Return `null` if another transaction changed the action first.

- [ ] **Step 7: Run focused service tests to verify success**

Run: `pnpm --filter @paperclipai/server test -- blocker-graph-conflict.test.ts issue-recovery-actions.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add server/src/services/recovery/blocker-graph-conflict.ts server/src/services/recovery/blocker-graph-conflict.test.ts server/src/services/issue-recovery-actions.ts server/src/__tests__/issue-recovery-actions.test.ts
git commit -m "fix(recovery): escalate blocker graph conflicts"
```

### Task 2: Contain Cycle-Rejected Recovery Writes

**Files:**
- Modify: `server/src/services/recovery/service.ts:3476-3629, 5658-5665`
- Test: `server/src/__tests__/issue-recovery-actions.test.ts:141-229`

**Interfaces:**
- Consumes: both Task 1 interfaces.
- Produces: `reconcileStrandedAssignedIssues()` result field `blockerGraphConflicts: number`.
- Consumed by: startup logging in Task 3.

- [ ] **Step 1: Write the failing real-cycle fixture**

In the embedded PostgreSQL test, seed blocked source `P`, open child `C`, existing relation `P blocks C`, and an active board-owned non-execution-reconciliation recovery action for `P`. Reconciliation attempts to restore `C blocks P`, which must produce the real cycle validator error.

```ts
expect(result).toMatchObject({ blockerGraphConflicts: 1, escalated: 1 });
expect(await relation(sourceIssueId, childIssueId)).toBeTruthy();
expect(await relation(childIssueId, sourceIssueId)).toBeFalsy();
expect(await activeActionFor(sourceIssueId)).toMatchObject({
  status: "escalated", outcome: "blocked", resolutionNote: "blocker_graph_conflict",
});
```

- [ ] **Step 2: Run the fixture to verify current behavior fails**

Run: `pnpm --filter @paperclipai/server test -- issue-recovery-actions.test.ts`

Expected: FAIL with `Blocking relations cannot contain cycles`.

- [ ] **Step 3: Implement narrow containment in `reconcileActiveRecoveryActions()`**

Wrap only the healthy-child `issuesSvc.update(...blockedByIssueIds)` call. If Task 1 classifies the error, call `escalateForBlockerGraphConflict`, increment `blockerGraphConflicts` and `escalated` only if that update succeeded, add the source issue ID, emit one structured warning with action/company/source IDs and `reason: "blocker_graph_conflict"`, then continue. Rethrow every other error.

Before calculating healthy children, recognize an action already `escalated` with `resolutionNote === "blocker_graph_conflict"`; increment `skipped` and continue without writing or logging again. Add and fold `blockerGraphConflicts: 0` through the outer stranded-issue result.

- [ ] **Step 4: Add repeat-sweep and non-cycle regressions**

Call the fixture reconciliation twice; the second result must include `{ blockerGraphConflicts: 0, skipped: 1 }` and leave both relations/action untouched. Exercise a different 422 through the exact classifier seam and assert it rejects rather than escalating.

- [ ] **Step 5: Run focused recovery tests to verify success**

Run: `pnpm --filter @paperclipai/server test -- blocker-graph-conflict.test.ts issue-recovery-actions.test.ts`

Expected: PASS; the real cycle fixture resolves as a manual hold while the non-cycle error remains uncontained.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/src/services/recovery/service.ts server/src/__tests__/issue-recovery-actions.test.ts server/src/services/recovery/blocker-graph-conflict.test.ts
git commit -m "fix(recovery): contain blocker-cycle restoration failures"
```

### Task 3: Preserve Startup Availability and Verify the Default Instance

**Files:**
- Modify: `server/src/index.ts:1620-1634`
- Modify: `server/src/__tests__/server-startup-feedback-export.test.ts:75-108`
- Modify only if evidence changes: `doc/plans/2026-10-23-recovery-reconciliation-resilience-design.md`

**Interfaces:**
- Consumes: `reconciled.blockerGraphConflicts` from Task 2.
- Produces: existing startup recovery warning with a contained-conflict count; no broad startup catch.

- [ ] **Step 1: Write the failing startup-harness assertion**

Add `blockerGraphConflicts: 0` to the default heartbeat mock. Add a test returning `{ blockerGraphConflicts: 1, escalated: 1, issueIds: ["issue-1"] }`; assert `startServer()` resolves and the existing startup changed-state warning includes the count.

- [ ] **Step 2: Run the startup test to verify it fails**

Run: `pnpm --filter @paperclipai/server test -- server-startup-feedback-export.test.ts`

Expected: FAIL because startup does not inspect `blockerGraphConflicts`.

- [ ] **Step 3: Include `reconciled.blockerGraphConflicts > 0` in the existing startup warning condition**

Extend only the existing changed-state condition/payload in `server/src/index.ts`. Do not add a catch-all recovery error handler: unexpected recovery failures must retain their current behavior.

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm --filter @paperclipai/server test -- blocker-graph-conflict.test.ts issue-recovery-actions.test.ts server-startup-feedback-export.test.ts
pnpm --filter @paperclipai/server typecheck
```

Expected: both commands PASS.

- [ ] **Step 5: Verify the default instance without suppression**

Use the managed dev stop command, then start one `pnpm dev:once` process with `PAPERCLIP_DATABASE_RESTORE_IN_PROGRESS` unset. Confirm:

```bash
curl --fail --max-time 10 http://127.0.0.1:3100/api/health
```

Expected: `{"status":"ok",...}`. Do not delete the embedded DB, write SQL, alter task relations, or automatically resolve `TWS-41` / `TWS-36`.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/src/index.ts server/src/__tests__/server-startup-feedback-export.test.ts doc/plans/2026-10-23-recovery-reconciliation-resilience-design.md
git commit -m "fix(server): report contained recovery graph conflicts"
```

Omit the design document from the commit if live verification does not change it.

## Self-Review

- **Spec coverage:** Task 1 adds the existing board-visible manual hold; Task 2 preserves graph validation and bounds retries; Task 3 exposes the outcome without broad startup suppression and verifies normal scheduling.
- **Type consistency:** Task 1 defines both interfaces used in Task 2; Task 2 defines `blockerGraphConflicts`; Task 3 adds it to the startup mock and reads it from the aggregate result.
- **Review focus coverage:** exact classifier (Task 1), graph preservation/repeat tick/non-cycle errors (Task 2), concurrency (Task 1), and readiness (Task 3) each have an explicit test.
- **Scope:** No schema migration, graph scanner, UI redesign, or automatic repair of native execution holds is included.
