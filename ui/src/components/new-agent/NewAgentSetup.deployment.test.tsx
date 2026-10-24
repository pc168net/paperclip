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
vi.mock("../onboarding/onboarding-motion", async () => {
  const actual = await vi.importActual<typeof import("../onboarding/onboarding-motion")>("../onboarding/onboarding-motion");
  return { ...actual, stepMotion: {} };
});
vi.mock("../new-agent/AgentBasicsDialog", () => ({ AgentBasicsDialog: () => null, AdapterMark: () => null }));
vi.mock("@/adapters", () => ({ getUIAdapter: () => ({ buildAdapterConfig: (value: Record<string, unknown>) => value }) }));
vi.mock("@/adapters/adapter-display-registry", () => ({ getAdapterDisplay: () => ({ label: "OpenAI" }), getAdapterLabels: () => ({}) }));
vi.mock("../ai-connections/AiConnectionField", () => ({
  AiConnectionField: ({ onChange }: { onChange: (binding: unknown) => void }) => (
    <>
      <button type="button" onClick={() => onChange({ provider: "openai", method: "api_key", mode: "shared", connectionId: "00000000-0000-4000-8000-000000000021", grantId: "00000000-0000-4000-8000-000000000022", deploymentId: "00000000-0000-4000-8000-000000000023" })}>
        Select stale deployment
      </button>
      <button type="button" onClick={() => onChange({ provider: "openai", method: "api_key", mode: "shared", connectionId: "00000000-0000-4000-8000-000000000021", grantId: "00000000-0000-4000-8000-000000000022", deploymentId: "00000000-0000-4000-8000-000000000025" })}>
        Select verified deployment
      </button>
    </>
  ),
}));

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  hire: vi.fn(),
  testEnvironment: vi.fn(),
}));
const roleProfilesApi = vi.hoisted(() => ({ list: vi.fn() }));
const setupState = vi.hoisted(() => ({ agents: [{ id: "ceo", role: "ceo", status: "idle" }] as Array<{ id: string; role: string; status: string }> }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn(async () => setupState.agents), adapterModels: vi.fn(), hire: api.hire, testEnvironment: api.testEnvironment } }));
vi.mock("@/api/agentRoleProfiles", () => ({ agentRoleProfilesApi: roleProfilesApi }));
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
  setupState.agents = [{ id: "ceo", role: "ceo", status: "idle" }];
  roleProfilesApi.list.mockResolvedValue([{
    id: "profile-1", companyId: "company-1", key: "researcher", name: "Researcher", description: "Research instructions", kind: "seeded", readOnly: false,
    revision: { id: "revision-1", number: 2, managedFiles: { "AGENTS.md": "# Research" }, changeSummary: null, createdAt: "2026-10-24T00:00:00Z" },
  }]);
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

it("persists the verified Connector deployment binding when setup finishes", async () => {
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
      deployments: [{
        id: "00000000-0000-4000-8000-000000000025",
        companyId: "company-1",
        connectionId: "00000000-0000-4000-8000-000000000021",
        modelId: "azure-verified",
        displayName: "Azure verified deployment",
        protocol: "responses",
        status: "verified",
        verifiedCredentialEpoch: 1,
        lastError: null,
        verifiedAt: "2026-10-23T00:00:00.000Z",
        createdByUserId: "user-1",
      }],
    }],
  });
  api.testEnvironment.mockResolvedValueOnce({
    adapterType: "codex_local",
    status: "pass",
    checks: [{ code: "openai_hello_probe_passed", level: "info", message: "Verified deployment responded." }],
    testedAt: "2026-10-23T00:00:00.000Z",
  });
  api.hire.mockResolvedValueOnce({ agent: { id: "agent-1", name: "Atlas", status: "idle" }, approval: null });

  await act(async () => {
    root.render(<QueryClientProvider client={client}><NewAgentSetup /></QueryClientProvider>);
  });
  await settle();

  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Select verified deployment")?.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use connection")?.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Finish setup")?.click());
  await settle();

  expect(api.hire).toHaveBeenCalledWith("company-1", expect.objectContaining({
    runtimeConfig: expect.objectContaining({
      aiConnection: {
        provider: "openai",
        method: "api_key",
        mode: "shared",
        connectionId: "00000000-0000-4000-8000-000000000021",
        grantId: "00000000-0000-4000-8000-000000000022",
        deploymentId: "00000000-0000-4000-8000-000000000025",
      },
    }),
  }));
});

it("requires duplicate confirmation before creating an agent from a Profile", async () => {
  api.testEnvironment.mockResolvedValueOnce({
    adapterType: "codex_local", status: "pass",
    checks: [{ code: "openai_hello_probe_passed", level: "info", message: "Verified deployment responded." }],
    testedAt: "2026-10-23T00:00:00.000Z",
  });
  api.hire.mockResolvedValueOnce({ agent: { id: "agent-1", name: "Atlas", status: "idle" }, approval: null });

  await act(async () => {
    root.render(<QueryClientProvider client={client}><NewAgentSetup /></QueryClientProvider>);
  });
  await settle();

  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Select verified deployment")?.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use connection")?.click());
  await settle();

  const profile = container.querySelector<HTMLSelectElement>('select[aria-label="Role Profile"]');
  expect(profile).not.toBeNull();
  await act(async () => {
    profile!.value = "profile-1";
    profile!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("AGENTS.md");

  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Finish setup")?.click());
  await settle();
  expect(api.hire).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Create another agent with this Profile?");

  await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Create duplicate agent")?.click());
  await settle();
  expect(api.hire).toHaveBeenCalledWith("company-1", expect.objectContaining({
    roleProfileId: "profile-1",
    roleProfileRevisionId: "revision-1",
    allowDuplicate: true,
  }));
});

it("keeps Role Profiles out of the first-agent CEO flow", async () => {
  setupState.agents = [];
  await act(async () => {
    root.render(<QueryClientProvider client={client}><NewAgentSetup /></QueryClientProvider>);
  });
  await settle();

  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Select verified deployment")?.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use connection")?.click());
  await settle();

  expect(container.querySelector('select[aria-label="Role Profile"]')).toBeNull();
  expect(container.textContent).not.toContain("Role Profile");
});

it("offers a retry action when Role Profiles cannot load", async () => {
  roleProfilesApi.list.mockRejectedValueOnce(new Error("Profiles unavailable"));
  await act(async () => {
    root.render(<QueryClientProvider client={client}><NewAgentSetup /></QueryClientProvider>);
  });
  await settle();

  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Select verified deployment")?.click());
  await settle();
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use connection")?.click());
  await settle();

  expect(container.textContent).toContain("Could not load Role Profiles");
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Retry Role Profiles");
  expect(retry).toBeTruthy();
  await act(async () => retry!.click());
  expect(roleProfilesApi.list).toHaveBeenCalledTimes(2);
});
