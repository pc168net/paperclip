# Recovery Reconciliation Resilience Design

## Intent

Prevent a stale recovery action from blocking Paperclip startup or task execution when its attempt to restore a task's blocker state conflicts with the current dependency graph. Preserve the failed action for operator diagnosis; do not silently remove task dependencies or replay provider work.

## Evidence and Current State

- The default instance has 30 persisted `issue_relations` edges, all in `twsoft`; a read-only recursive graph scan found no persisted cycle.
- Two active recovery actions (`TWS-41` and `TWS-36`) have cause `native_continuation_requires_reconciliation`.
- `reconcileActiveRecoveryActions()` can call `issuesSvc.update()` to restore a source issue to `blocked` with healthy child issues as blockers.
- `syncBlockedByIssueIds()` validates the requested blocker set against the live graph and rejects a cycle with HTTP 422.
- The startup heartbeat recovery awaits that reconciliation without a local containment boundary. A single rejected action therefore rejects startup work and prevents the server from remaining available.

## Goals

- Keep server UI/API startup available when one recovery action has an irreconcilable blocker graph.
- Never bypass blocker-cycle validation or mutate graph state after validation fails.
- Persist a terminal, inspectable outcome for the specific recovery action so periodic recovery does not retry it forever.
- Preserve company isolation and existing execution-reconciliation holds.
- Provide explicit operator evidence identifying the action, source issue, and safe reason it needs manual attention.
- Repair the existing affected action(s) through the normal recovery-action service, not direct database edits.

## Non-goals

- Do not automatically delete or rewrite historical issue relations.
- Do not add an admin graph-management UI or an instance-wide periodic integrity scanner in this change.
- Do not resume or replay an uncertain provider execution.
- Do not weaken the rule that task blocker graphs are acyclic.

## Approaches Considered

### 1. Startup-only catch

Catch every startup recovery error in `server/src/index.ts` and log it. This keeps the app alive but leaves actions active and repeatedly failing, hides per-action diagnosis, and does not make periodic recovery safe. Rejected.

### 2. Recovery-scoped conflict disposition (chosen)

In `reconcileActiveRecoveryActions()`, isolate the specific blocker-state restoration. When `issuesSvc.update()` returns the known graph-conflict validation error, preserve the issue and relations, terminalize that action through the recovery-action service with a distinct outcome/resolution note, and continue processing other actions. Make the startup scheduler treat the aggregate reconciliation as successful when all individual conflicts are contained. Add public-path regression coverage for both startup and periodic recovery.

This keeps dependency validation authoritative, bounds retries, and makes operator attention explicit without treating a data conflict as a server-wide failure.

### 3. Recovery-scoped disposition plus periodic graph health scanner

Add approach 2 and a periodic scan of all issue relations for cycles/orphans/cross-company edges. This would improve observability but expands the change into a new operational product surface with separate remediation and performance design. Deferred.

## Chosen Design

### Recovery action behavior

1. Keep `issuesSvc.update()` and its existing transactional cycle validation as the sole graph mutation path.
2. Wrap only the healthy-child blocker restoration branch in a narrow classifier for the known `422` cycle-conflict error.
3. On that known conflict:
   - make no dependency graph mutation;
   - resolve/terminalize the recovery action with a distinct operator-facing outcome such as `manual_attention_required` and a resolution note that identifies `blocker_graph_conflict` without leaking unrelated data;
   - increment a new contained-conflict result count and retain the source issue ID for structured logs;
   - continue reconciling the remaining actions.
4. Re-throw unexpected database, authorization, and service failures. Those remain genuine degraded recovery failures and must not be hidden.
5. Native execution-reconciliation causes keep their existing hold semantics unless the failing branch is specifically the blocker restoration path.

### Startup and periodic scheduling

- Startup recovery must receive an aggregate result from action reconciliation rather than a rejection for a contained, known graph conflict.
- Log one structured warning per contained action with action ID, company ID, source issue ID, and safe disposition reason.
- Periodic reconciliation uses the same service behavior, so the terminal action is not retried and cannot produce a recurring server-wide error.

### Historical data remediation

- Identify active actions with the new conflict disposition through the existing recovery-action query/service surface.
- For the currently observed actions, use the same service-level terminalization path after confirming the source issue and current relations; do not delete rows with SQL.
- The operator decides any later task-relationship edit separately. The automatic repair does not guess which relation to remove.

## Interfaces and Files

- `server/src/services/recovery/service.ts` — classify and contain the known blocker-restoration conflict; return structured aggregate evidence.
- `server/src/services/recovery/*.test.ts` — recovery reconciliation regression for stale action/healthy-child conflict and bounded retry behavior.
- `server/src/index.ts` and its startup tests — prove a contained recovery conflict does not reject server startup, while unexpected recovery failures retain current behavior.
- `server/src/services/issues.ts` tests — preserve current cycle validator behavior as the graph authority.
- Existing recovery-action service/schema — reuse terminal status/outcome fields; no schema migration unless inspection proves its existing enum/contract cannot represent the chosen terminal outcome.

## Verification

- RED/GREEN service test: a source issue whose recovery restoration would create a cycle leaves relations unchanged, records the terminal action disposition, and permits other actions to reconcile.
- Startup integration test: the contained action does not prevent `/api/health` startup readiness or periodic scheduling.
- Regression test: an unexpected `issuesSvc.update()` failure still propagates/logs as degraded recovery rather than being classified as a graph conflict.
- Existing issue relation cycle tests continue passing.
- Live local verification: start the default instance without recovery suppression, confirm health is ready, confirm the action is terminalized once, and confirm task scheduling is enabled.

## Risks and Mitigations

- **Misclassifying an unrelated 422:** classify by the typed `HttpError` status and exact cycle-validation message/code at the recovery boundary; test a different 422 as unexpected.
- **Hiding operator work:** retain the recovery row with explicit outcome, resolution note, and structured log instead of deleting it.
- **Retrying provider work:** no new wake or run is created on graph conflict; the source remains visibly held for manual review.
- **Over-scoping historical repair:** this design does not mutate issue relations automatically.

## Builder Decisions Still Open

- Exact existing recovery-action terminal status/outcome vocabulary to use for manual attention must be selected from the service's current contract after inspection. The implementer should reuse an existing value if it represents this state; add a new value only when no safe existing representation exists.
