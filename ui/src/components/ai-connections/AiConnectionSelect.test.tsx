// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiConnectionSelect } from "./AiConnectionSelect";
import type { AiManagedConnectionSummary } from "@paperclipai/shared";

vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const onChange = vi.fn();

function connection(overrides: Partial<AiManagedConnectionSummary> = {}): AiManagedConnectionSummary {
  return {
    id: "connection-1",
    grantId: "grant-1",
    companyId: "company-1",
    provider: "openai",
    method: "api_key",
    name: "Company OpenAI",
    ownership: "shared",
    isDefault: false,
    status: "connected",
    routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://example.com/v1", models: [] },
    deployments: [],
    ...overrides,
  };
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await act(async () => {});
  }
}

beforeEach(() => {
  vi.clearAllMocks();
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

async function mount(connections: AiManagedConnectionSummary[], value?: Parameters<typeof AiConnectionSelect>[0]["value"]) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AiConnectionSelect
          requirement={{ companyId: "company-1", provider: "openai" }}
          connections={connections}
          value={value}
          currentUserId="user-1"
          agentId="agent-1"
          agentName="Nova"
          adapterType="codex_local"
          connectedOnly
          onChange={onChange}
          onConnect={vi.fn()}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
}

function openSelect() {
  const trigger = container.querySelector('[role="combobox"][aria-label="Connection"]') as HTMLElement;
  expect(trigger).toBeTruthy();
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
}

it("shows only verified same-company deployments and omits plain/default options", async () => {
  const selected = {
    id: "deployment-verified",
    companyId: "company-1",
    connectionId: "connection-1",
    modelId: "azure-prod",
    displayName: "Azure Prod",
    protocol: "responses" as const,
    status: "verified" as const,
    verifiedCredentialEpoch: 1,
    lastError: null,
    verifiedAt: null,
    createdByUserId: null,
  };
  await mount([
    connection({ deployments: [selected, { ...selected, id: "deployment-stale", modelId: "azure-stale", status: "stale" }] }),
    { ...connection({ id: "plain-connection", name: "Plain AI", routing: undefined }), deployments: [] },
    connection({ id: "other-connection", companyId: "other-company", grantId: "other-grant", name: "Other Company", deployments: [{ ...selected, id: "deployment-other", companyId: "other-company", modelId: "other-prod" }] }),
    connection({ id: "needs-attention", grantId: "grant-2", name: "Needs Attention", status: "needs_attention", deployments: [selected] }),
  ]);

  expect(container.textContent).not.toContain("Connect an account");
  expect(container.textContent).not.toContain("Reconnect account");
  openSelect();
  await settle();

  const options = Array.from(document.querySelectorAll('[role="option"]')).map((node) => node.textContent ?? "");
  expect(options).toHaveLength(1);
  expect(options.some((text) => text.includes("Company OpenAI") && text.includes("azure-prod"))).toBe(true);
  expect(options.some((text) => text.includes("azure-stale"))).toBe(false);
  expect(options.some((text) => text.includes("Plain AI"))).toBe(false);
  expect(options.some((text) => text.includes("Other Company"))).toBe(false);
  expect(container.textContent).not.toContain("Responsible user’s default");

  const choice = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent?.includes("azure-prod"));
  expect(choice).toBeTruthy();
  act(() => choice!.click());

  expect(onChange).toHaveBeenCalledWith({
    provider: "openai",
    method: "api_key",
    mode: "shared",
    connectionId: "connection-1",
    grantId: "grant-1",
    deploymentId: "deployment-verified",
  });
});

it("rejects stale and failed deployments in connected-only mode", async () => {
  const stale = {
    id: "deployment-stale",
    companyId: "company-1",
    connectionId: "connection-1",
    modelId: "azure-stale",
    displayName: "Azure Stale",
    protocol: "responses" as const,
    status: "stale" as const,
    verifiedCredentialEpoch: 1,
    lastError: null,
    verifiedAt: null,
    createdByUserId: null,
  };
  const failed = { ...stale, id: "deployment-failed", modelId: "azure-failed", displayName: "Azure Failed", status: "failed" as const };
  await mount([connection({ deployments: [stale, failed] })]);

  openSelect();
  await settle();

  expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  expect(container.textContent).toContain("No verified deployment is available");
});

it("shows the verified deployment guidance when none are available", async () => {
  await mount([connection({ deployments: [], status: "needs_attention" })]);

  expect(container.textContent).toContain("No verified deployment is available");
  expect(container.textContent).not.toContain("Connect an account");
  expect(container.textContent).not.toContain("Reconnect account");
});
