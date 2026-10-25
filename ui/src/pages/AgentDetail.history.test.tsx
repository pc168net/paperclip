// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { AgentDetail, HeartbeatRun } from "@paperclipai/shared";
import { afterEach, expect, it, vi } from "vitest";
import { AgentOverview, RunsTab } from "./AgentDetail";
import { AgentOverview as ProductionAgentOverview, RunsTab as ProductionRunsTab } from "./AgentDetail.production";
import { ToastProvider } from "../context/ToastContext";
import { PanelProvider } from "../context/PanelContext";

const { get, events, mobile } = vi.hoisted(() => ({ get: vi.fn(), events: vi.fn(), mobile: { value: false } }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: { get, events, workspaceOperations: async () => [] } }));
vi.mock("../api/agents", () => ({ agentsApi: { getIdentity: async () => null } }));
vi.mock("../api/client", () => ({ api: { get: async () => [] } }));
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: async () => ({ companyIds: ["company-1"], memberships: [] }) } }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: mobile.value }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", selectedCompany: { id: "company-1", issuePrefix: "TEST" }, companies: [] }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { get.mockReset(); events.mockReset(); events.mockResolvedValue([]); });

it("shows the server-projected connection deployment model in the agent overview", async () => {
  const agent = {
    id: "agent-1", companyId: "company-1", name: "Alpha", urlKey: "alpha", role: "engineer", title: null,
    icon: null, status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local",
    adapterConfig: { model: "gpt-5.6-sol" }, runtimeConfig: {}, effectiveModel: "gpt-5.6-terra",
    modelSource: "verified_deployment", budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null,
    pausedAt: null, permissions: { canCreateAgents: false }, lastHeartbeatAt: null, metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as AgentDetail;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><AgentOverview
      agent={agent} runs={[]} assignedIssues={[]} directReportCount={0} skillNames={[]} agentRouteId="agent-1"
    /></MemoryRouter></QueryClientProvider>));
    expect(element.textContent).toContain("gpt-5.6-terra");
    expect(element.textContent).toContain("Connection deployment");
    expect(element.textContent).toContain("gpt-5.6-sol");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});

it.each(["streamlined", "production"] as const)("suppresses rate-limited result summaries in the %s Latest Run card", async (variant) => {
  const agent = {
    id: "agent-1", companyId: "company-1", name: "Alpha", urlKey: "alpha", role: "engineer", title: null,
    icon: null, status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local", adapterConfig: {},
    runtimeConfig: {}, budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null, pausedAt: null,
    permissions: { canCreateAgents: false }, lastHeartbeatAt: null, metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as unknown as AgentDetail;
  const run = {
    id: "rate-limited-latest-run", companyId: "company-1", agentId: "agent-1", status: "failed", invocationSource: "automation",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", usageJson: null,
    resultJson: { summary: "Azure provider Latest Run summary: eastus-private" }, contextSnapshot: null, exitCode: 1,
    error: "Azure provider payload", errorCode: "native_provider_rate_limited", logRef: null, startedAt: null, finishedAt: null,
  } as unknown as HeartbeatRun;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    const overview = variant === "production"
      ? <ProductionAgentOverview agent={agent} runs={[run]} assignedIssues={[]} agentId="agent-1" agentRouteId="agent-1" />
      : <AgentOverview agent={agent} runs={[run]} assignedIssues={[]} directReportCount={0} skillNames={[]} agentRouteId="agent-1" />;
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{overview}</MemoryRouter></QueryClientProvider>));
    expect(element.textContent).toContain("Latest Run");
    expect(element.textContent).not.toContain("Azure provider Latest Run summary");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});

it.each([
  ["streamlined", RunsTab],
  ["production", ProductionRunsTab],
] as const)("shows a safe rate-limit retry with its scheduled time and configured fallback in the %s runs view", async (_variant, Tab) => {
  const run = {
    id: "rate-limited-run", companyId: "company-1", agentId: "agent-1", status: "scheduled_retry", invocationSource: "automation",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", usageJson: null, resultJson: null,
    contextSnapshot: { rateLimitRecovery: { fallbackModel: { model: "gpt-5.6-sol" } } }, exitCode: null,
    error: "Azure provider payload: rate limit for deployment eastus-private", errorCode: "native_provider_rate_limited", logRef: null,
    startedAt: null, finishedAt: null, scheduledRetryReason: "native_provider_rate_limited",
    scheduledRetryAt: "2026-01-01T00:05:00Z", scheduledRetryAttempt: 1, retryOfRunId: null,
  } as unknown as HeartbeatRun;
  get.mockResolvedValue(run);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><PanelProvider><ToastProvider>
      <Tab runs={[run]} companyId="company-1" agentId="agent-1" agentRouteId="agent-1" selectedRunId="rate-limited-run" adapterType="codex_local" adapterConfig={{}} />
    </ToastProvider></PanelProvider></MemoryRouter></QueryClientProvider>));
    await vi.waitFor(async () => { await act(async () => {}); expect(element.textContent).toContain("Model rate limited"); });
    expect(element.textContent).toContain("Next retry");
    expect(element.textContent).toContain("gpt-5.6-sol");
    expect(element.textContent).not.toContain("Azure provider payload");
    expect(element.textContent).not.toContain("native_provider_rate_limited");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});

it.each([
  ["streamlined", RunsTab],
  ["production", ProductionRunsTab],
] as const)("retains Failure details and result JSON for an ordinary failed %s run", async (_variant, Tab) => {
  const run = {
    id: "ordinary-failed-run", companyId: "company-1", agentId: "agent-1", status: "failed", invocationSource: "automation",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", usageJson: null,
    resultJson: { summary: "ordinary adapter failure summary", diagnostic: "ordinary adapter result" }, contextSnapshot: null,
    exitCode: 1, error: "ordinary adapter failure", errorCode: "adapter_failed", logRef: null,
    startedAt: null, finishedAt: "2026-01-01T00:01:00Z", retryOfRunId: null,
  } as unknown as HeartbeatRun;
  get.mockResolvedValue(run);
  events.mockResolvedValue([{ id: "event-1", createdAt: "2026-01-01T00:01:00Z", stream: "system", chunk: "run failed" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><PanelProvider><ToastProvider>
      <Tab runs={[run]} companyId="company-1" agentId="agent-1" agentRouteId="agent-1" selectedRunId="ordinary-failed-run" adapterType="codex_local" adapterConfig={{}} />
    </ToastProvider></PanelProvider></MemoryRouter></QueryClientProvider>));
    await vi.waitFor(async () => { await act(async () => {}); expect(element.textContent).toContain("Failure details"); });
    expect(element.textContent).toContain("ordinary adapter failure");
    expect(element.textContent).toContain("adapter result JSON");
    expect(element.textContent).toContain("ordinary adapter result");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});

it.each([
  ["streamlined", RunsTab],
  ["production", ProductionRunsTab],
] as const)("retains Failure details and result JSON for an ordinary timed-out %s run", async (_variant, Tab) => {
  const run = {
    id: "ordinary-timed-out-run", companyId: "company-1", agentId: "agent-1", status: "timed_out", invocationSource: "automation",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", usageJson: null,
    resultJson: { summary: "ordinary adapter timeout summary", diagnostic: "ordinary timeout result" }, contextSnapshot: null,
    exitCode: 124, error: "ordinary adapter timeout", errorCode: "adapter_timed_out", logRef: null,
    startedAt: null, finishedAt: "2026-01-01T00:01:00Z", retryOfRunId: null,
  } as unknown as HeartbeatRun;
  get.mockResolvedValue(run);
  events.mockResolvedValue([{ id: "event-1", createdAt: "2026-01-01T00:01:00Z", stream: "system", chunk: "run timed out" }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><PanelProvider><ToastProvider>
      <Tab runs={[run]} companyId="company-1" agentId="agent-1" agentRouteId="agent-1" selectedRunId="ordinary-timed-out-run" adapterType="codex_local" adapterConfig={{}} />
    </ToastProvider></PanelProvider></MemoryRouter></QueryClientProvider>));
    await vi.waitFor(async () => { await act(async () => {}); expect(element.textContent).toContain("Failure details"); });
    expect(element.textContent).toContain("ordinary adapter timeout");
    expect(element.textContent).toContain("adapter result JSON");
    expect(element.textContent).toContain("ordinary timeout result");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});

it.each([
  ["streamlined", RunsTab],
  ["production", ProductionRunsTab],
] as const)("hides provider result summaries and failure details for a rate-limited %s run", async (_variant, Tab) => {
  const run = {
    id: "rate-limited-failed-run", companyId: "company-1", agentId: "agent-1", status: "failed", invocationSource: "automation",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    resultJson: { summary: "Azure provider result summary: eastus-private", providerPayload: "secret provider error" },
    usageJson: null, contextSnapshot: null, exitCode: 1, error: "Azure provider payload: deployment eastus-private",
    errorCode: "native_provider_rate_limited", stderrExcerpt: "provider stderr", stdoutExcerpt: "provider stdout", logRef: null,
    startedAt: null, finishedAt: "2026-01-01T00:01:00Z", retryOfRunId: null,
  } as unknown as HeartbeatRun;
  get.mockResolvedValue(run);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><PanelProvider><ToastProvider>
      <Tab runs={[run]} companyId="company-1" agentId="agent-1" agentRouteId="agent-1" selectedRunId="rate-limited-failed-run" adapterType="codex_local" adapterConfig={{}} />
    </ToastProvider></PanelProvider></MemoryRouter></QueryClientProvider>));
    await vi.waitFor(async () => { await act(async () => {}); expect(element.textContent).toContain("failed"); });
    expect(element.textContent).not.toContain("Azure provider result summary");
    expect(element.textContent).not.toContain("secret provider error");
    expect(element.textContent).not.toContain("Azure provider payload");
    expect(element.textContent).not.toContain("native_provider_rate_limited");
    expect(element.textContent).not.toContain("Failure details");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});

it.each([
  { Tab: RunsTab, isMobile: false }, { Tab: ProductionRunsTab, isMobile: false },
  { Tab: RunsTab, isMobile: true }, { Tab: ProductionRunsTab, isMobile: true },
])("renders an older selected run when history is empty (%#)", async ({ Tab, isMobile }) => {
  mobile.value = isMobile;
  const run = { id: "older-run", companyId: "company-1", agentId: "agent-1", status: "succeeded", invocationSource: "manual",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", usageJson: null, resultJson: null,
    contextSnapshot: null, exitCode: 0, error: null, logRef: null, startedAt: null, finishedAt: null } as unknown as HeartbeatRun;
  get.mockResolvedValue(run);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement("div"); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><PanelProvider><ToastProvider>
      <Tab runs={[]} companyId="company-1" agentId="agent-1" agentRouteId="agent-1" selectedRunId="older-run" adapterType="codex_local" adapterConfig={{}} />
    </ToastProvider></PanelProvider></MemoryRouter></QueryClientProvider>));
    await vi.waitFor(async () => { await act(async () => {}); expect(element.textContent).toContain("succeeded"); });
    expect(element.textContent).not.toContain("No runs yet.");
    expect(get).toHaveBeenCalledWith("older-run");
  } finally { await act(async () => root.unmount()); client.clear(); element.remove(); }
});
