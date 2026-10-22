// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewAgentSetup } from "./NewAgentSetup";

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams({ name: "Atlas", adapterType: "codex_local", runnerProvider: "codex" })],
}));
vi.mock("@/context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: vi.fn() }) }));
vi.mock("@/hooks/useCloudInstance", () => ({ useCloudInstance: () => false }));
vi.mock("../AgentCharacter", () => ({ AgentCharacter: () => null }));
vi.mock("../onboarding/onboarding-motion", () => ({ stepMotion: {} }));
vi.mock("../new-agent/AgentBasicsDialog", () => ({ AgentBasicsDialog: () => null, AdapterMark: () => null }));
vi.mock("@/adapters", () => ({ getUIAdapter: () => ({ buildAdapterConfig: (value: Record<string, unknown>) => value }) }));
vi.mock("@/adapters/adapter-display-registry", () => ({ getAdapterDisplay: () => ({ label: "OpenAI" }), getAdapterLabels: () => ({}) }));
vi.mock("../ai-connections/AiConnectionField", () => ({
  AiConnectionField: ({ onChange }: { onChange: (binding: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ provider: "openai", method: "api_key", mode: "shared", connectionId: "00000000-0000-4000-8000-000000000021", grantId: "00000000-0000-4000-8000-000000000022", deploymentId: "00000000-0000-4000-8000-000000000023" })}>
      Select stale deployment
    </button>
    ),
}));

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  hire: vi.fn(),
  testEnvironment: vi.fn(),
}));
vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn(async () => [{ id: "ceo", role: "ceo", status: "idle" }]), adapterModels: vi.fn(), hire: api.hire, testEnvironment: api.testEnvironment } }));
vi.mock("@/api/adapters", () => ({ adaptersApi: { list: vi.fn(async () => [{ type: "codex_local", loaded: true, disabled: false }, { type: "paperclip_runner", loaded: true, disabled: false }]) } }));
vi.mock("@/api/environments", () => ({ environmentsApi: { list: vi.fn(async () => [{ id: "local-1", name: "Local", driver: "local", config: {} }]), capabilities: vi.fn(async () => ({ sandboxProviders: {} })) } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { get: vi.fn(async () => ({ defaultEnvironmentId: "local-1" })), getExperimental: vi.fn(async () => ({ enableNativeRunner: true })), getGeneral: vi.fn(async () => ({ executionMode: "any" })) } }));
vi.mock("@/api/secrets", () => ({ secretsApi: { list: vi.fn(async () => []), listMyUserSecrets: vi.fn(async () => []) } }));
vi.mock("@/api/ai-connections", () => ({
  aiConnectionsApi: {
    list: api.listConnections,
  },
}));

api.listConnections.mockResolvedValue({
  currentUserId: "user-1",
  canManageConnections: true,
  connections: [{
    id: "00000000-0000-4000-8000-000000000021",
    grantId: "00000000-0000-4000-8000-000000000022",
    companyId: "company-1",
    provider: "openai",
    method: "api_key",
    name: "Company OpenAI",
    ownership: "shared",
    isDefault: false,
    status: "connected",
    routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://example.com/v1", models: [] },
    deployments: [{
      id: "00000000-0000-4000-8000-000000000023",
      companyId: "company-1",
      connectionId: "00000000-0000-4000-8000-000000000021",
      modelId: "azure-deployment",
      displayName: "Azure deployment",
      protocol: "responses",
      status: "stale",
      verifiedCredentialEpoch: 1,
      lastError: null,
      verifiedAt: null,
      createdByUserId: "user-1",
    }],
  }],
});

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await act(async () => {});
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

it.each(["stale", "failed"] as const)("shows a verification-needed state for %s deployments", async (status) => {
  const deployment = {
    id: status === "stale" ? "00000000-0000-4000-8000-000000000023" : "00000000-0000-4000-8000-000000000024",
    companyId: "company-1",
    connectionId: "00000000-0000-4000-8000-000000000021",
    modelId: status === "stale" ? "azure-stale" : "azure-failed",
    displayName: status === "stale" ? "Azure Stale" : "Azure Failed",
    protocol: "responses" as const,
    status,
    verifiedCredentialEpoch: 1,
    lastError: null,
    verifiedAt: null,
    createdByUserId: "user-1",
  };
  api.listConnections.mockResolvedValueOnce({
    currentUserId: "user-1",
    canManageConnections: true,
    connections: [{
      id: "00000000-0000-4000-8000-000000000021",
      grantId: "00000000-0000-4000-8000-000000000022",
      companyId: "company-1",
      provider: "openai",
      method: "api_key",
      name: "Company OpenAI",
      ownership: "shared",
      isDefault: false,
      status: "connected",
      routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://example.com/v1", models: [] },
      deployments: [deployment],
    }],
  });

  await act(async () => {
    root.render(<QueryClientProvider client={client}><NewAgentSetup /></QueryClientProvider>);
  });
  await settle();

  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Select stale deployment")?.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use connection")?.click());
  await settle();

  expect(container.textContent).toContain("This deployment is unavailable or needs verification.");
  expect(container.textContent).not.toContain("Verified deployment");
});
