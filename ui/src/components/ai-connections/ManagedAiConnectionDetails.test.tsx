// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ManagedAiConnectionDetails } from "./ManagedAiConnectionDetails";

vi.mock("@/lib/router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/api/ai-connections", () => ({
  aiConnectionsApi: {
    list: vi.fn(async () => ({
      currentUserId: "owner",
      canManageConnections: false,
      connections: [
        {
          id: "connection",
          grantId: "grant",
          companyId: "company",
          provider: "openai",
          method: "api_key",
          name: "Azure Connector",
          ownership: "personal",
          ownerUserId: "owner",
          createdByUserId: "owner",
          isDefault: false,
          status: "connected",
          routing: { kind: "gateway", protocol: "responses", auth: "api_key", baseUrl: "https://example.com/v1", models: [] },
        },
      ],
    })),
    deployments: vi.fn(async () => [
      { id: "verified", companyId: "company", connectionId: "connection", modelId: "prod", displayName: null, protocol: "responses", status: "verified", verifiedCredentialEpoch: 1, lastError: null, verifiedAt: new Date().toISOString(), createdByUserId: "owner" },
    ]),
    setDefault: vi.fn(),
    activeRuns: vi.fn(async () => []),
  },
}));

vi.mock("@/api/tools", () => ({
  toolsApi: {
    listConnectionGrants: vi.fn(async () => ({
      currentUserId: "owner",
      grants: [{ id: "grant", companyId: "company", connectionId: "connection", kind: "user", subjectUserId: "owner", providerTenant: {}, credentialSecretRefs: [], status: "active", isDefault: false, createdByUserId: "owner", revokedAt: null, revokedByAgentId: null, revokedByUserId: null, lastUsedAt: null, createdAt: new Date(), updatedAt: new Date() }],
    })),
    revokeConnectionGrant: vi.fn(async () => undefined),
  },
}));

vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { cancel: vi.fn() } }));

function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  return {
    client,
    container,
    async mount() {
      await act(async () => root.render(<QueryClientProvider client={client}><ManagedAiConnectionDetails connection={{ id: "connection", companyId: "company" } as never} /></QueryClientProvider>));
    },
    async unmount() {
      await act(async () => root.unmount());
      client.clear();
    },
  };
}

it("does not show deployment mutations to non-managers even when they own the connection", async () => {
  const { container, mount, unmount } = render();
  try {
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Verified deployments"));
    expect(container.textContent).not.toContain("Add deployment");
    expect(container.textContent).not.toContain("Verify");
    expect(container.textContent).not.toContain("Remove");
  } finally {
    await unmount();
  }
});
