import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { agentWakeupRequests, agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { accountingForScheduledRetry, executionFailureRetryCount } from "../execution-recovery-attempt.js";
import {
  NATIVE_PROVIDER_CAPACITY_MAX_RETRIES,
  NATIVE_PROVIDER_OVERLOADED_CODE,
  NATIVE_PROVIDER_OVERLOADED_MESSAGE,
  NATIVE_PROVIDER_RATE_LIMITED_CODE,
  NATIVE_PROVIDER_RATE_LIMITED_MESSAGE,
} from "./native-provider-failure.js";
import { logActivity } from "../activity-log.js";

export type ConfiguredFallbackModel = { provider: string; model: string };
export type NativeProviderCapacityRetryCode =
  | typeof NATIVE_PROVIDER_OVERLOADED_CODE
  | typeof NATIVE_PROVIDER_RATE_LIMITED_CODE;

export function isNativeProviderCapacityRetryCode(
  value: unknown,
): value is NativeProviderCapacityRetryCode {
  return (
    value === NATIVE_PROVIDER_OVERLOADED_CODE ||
    value === NATIVE_PROVIDER_RATE_LIMITED_CODE
  );
}

export function nativeProviderCapacityRetryMessage(
  code: NativeProviderCapacityRetryCode,
) {
  return code === NATIVE_PROVIDER_RATE_LIMITED_CODE
    ? NATIVE_PROVIDER_RATE_LIMITED_MESSAGE
    : NATIVE_PROVIDER_OVERLOADED_MESSAGE;
}

/** Fallbacks are opt-in. Never infer a sibling/default model from a provider. */
export function readConfiguredFallbackModel(value: unknown): ConfiguredFallbackModel | null {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const candidate = config.fallbackModel && typeof config.fallbackModel === "object"
    ? config.fallbackModel as Record<string, unknown> : null;
  const provider = typeof candidate?.provider === "string" ? candidate.provider.trim() : "";
  const model = typeof candidate?.model === "string" ? candidate.model.trim() : "";
  return provider && model ? { provider, model } : null;
}

/** Called under the finalizer's issue/coordinator locks, in the status-effect transaction. */
export async function materializeNativeProviderCapacityRetry(input: {
  tx: Db;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string;
  cause: NativeProviderCapacityRetryCode;
}) {
  const [run] = await input.tx.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.id, input.runId),
    eq(heartbeatRuns.agentId, input.agentId), eq(heartbeatRuns.nativeIssueId, input.issueId),
  )).for("update");
  if (!run || run.runtimeMode !== "native") throw new Error("native_capacity_retry_run_binding_mismatch");
  const [agent] = await input.tx.select({ adapterConfig: agents.adapterConfig }).from(agents).where(and(
    eq(agents.companyId, input.companyId), eq(agents.id, input.agentId),
  )).limit(1);
  const fallback = readConfiguredFallbackModel(agent?.adapterConfig);
  // Share the predecessor claim with every other failure-retry lane.
  const [existing] = await input.tx.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, input.companyId), eq(heartbeatRuns.retryOfRunId, run.id),
  )).limit(1);
  if (existing) return existing.id;
  const attempt = executionFailureRetryCount(run) + 1;
  if (attempt > NATIVE_PROVIDER_CAPACITY_MAX_RETRIES) throw new Error("native_capacity_retry_exhausted");
  const now = new Date();
  // Provider capacity/rate-limit retries are deliberately slow and bounded:
  // five minutes, then fifteen minutes. Do not turn a failed run into an
  // unbounded retry loop or create a replacement Agent.
  const dueAt = new Date(now.getTime() + (attempt === 1 ? 5 : 15) * 60_000);
  const retryId = randomUUID();
  const predecessorContext = { ...run.contextSnapshot };
  // Resume receipts and delivered wake input belong to the failed run. The
  // new turn has ordinary task authority; history comes from retryOfRunId.
  // Match the consumed-input boundary used by native safe replacements.
  for (const key of [
    "explicitUserContinuation", "wakeCommentId", "wakeCommentIds", "commentId",
    "commentIds", "latestCommentId", "resumeIntent", "followUpRequested",
    "paperclipWake", "paperclipWakeComment", "paperclipTaskMarkdown", "paperclipTaskMarkdownCompact",
    "paperclipTaskMarkdownAssignment", "paperclipTaskMarkdownAssignmentCompact", "paperclipTurnContext",
  ]) delete predecessorContext[key];
  const originalProvider = typeof (run.runnerProfileJson?.nativeExecutionInput as Record<string, unknown> | undefined)?.provider === "object"
    ? ((run.runnerProfileJson?.nativeExecutionInput as Record<string, unknown>).provider as Record<string, unknown>).kind
    : typeof (run.runnerProfileJson?.adapterDispatch as Record<string, unknown> | undefined)?.provider === "string"
      ? (run.runnerProfileJson?.adapterDispatch as Record<string, unknown>).provider : null;
  const originalModel = typeof (run.runnerProfileJson?.nativeExecutionInput as Record<string, unknown> | undefined)?.provider === "object"
    ? ((run.runnerProfileJson?.nativeExecutionInput as Record<string, unknown>).provider as Record<string, unknown>).model
    : typeof (run.runnerProfileJson?.adapterDispatch as Record<string, unknown> | undefined)?.model === "string"
      ? (run.runnerProfileJson?.adapterDispatch as Record<string, unknown>).model : null;
  const errorMessage = nativeProviderCapacityRetryMessage(input.cause);
  const contextSnapshot = {
    ...predecessorContext,
    issueId: input.issueId,
    taskId: input.issueId,
    forceFreshSession: true,
    retryOfRunId: run.id,
    retryReason: input.cause,
    wakeReason: input.cause,
    scheduledRetryAttempt: attempt,
    scheduledRetryAt: dueAt.toISOString(),
    executionRetryAccounting: accountingForScheduledRetry(run, input.cause, attempt),
    rateLimitRecovery: {
      provider: typeof originalProvider === "string" ? originalProvider : "codex",
      model: typeof originalModel === "string" ? originalModel : null,
      originalProvider: typeof originalProvider === "string" ? originalProvider : "codex",
      originalModel: typeof originalModel === "string" ? originalModel : null,
      originalError: errorMessage,
      fallbackProvider: fallback?.provider ?? null,
      fallbackModel: fallback?.model ?? null,
      category: "provider_capacity",
      retryCount: attempt,
      scheduledRetryAt: dueAt.toISOString(),
    },
  };
  const [wake] = await input.tx.insert(agentWakeupRequests).values({
    companyId: run.companyId, agentId: run.agentId, source: "automation", triggerDetail: "system",
    reason: input.cause, status: "queued", runId: retryId,
    idempotencyKey: `native-capacity:${run.companyId}:${run.id}`,
    requestedByActorType: "system", requestedByActorId: "native_finalizer",
    payload: contextSnapshot,
  }).returning({ id: agentWakeupRequests.id });
  await input.tx.insert(heartbeatRuns).values({
    id: retryId, companyId: run.companyId, agentId: run.agentId,
    invocationSource: "automation", triggerDetail: "system", status: "scheduled_retry",
    responsibleUserId: run.responsibleUserId, wakeupRequestId: wake.id,
    retryOfRunId: run.id, scheduledRetryReason: input.cause,
    scheduledRetryAttempt: attempt, scheduledRetryAt: dueAt,
    error: errorMessage, errorCode: input.cause,
    contextSnapshot,
  });
  await logActivity(input.tx, {
    companyId: run.companyId,
    actorType: "system",
    actorId: "native-provider-recovery",
    action: "heartbeat.rate_limit_retry_scheduled",
    entityType: "issue",
    entityId: input.issueId,
    agentId: run.agentId,
    runId: run.id,
    details: contextSnapshot.rateLimitRecovery,
  });
  return retryId;
}
