// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { AiConnectionDeploymentManager } from "./AiConnectionDeploymentManager";
import { aiConnectionsApi } from "@/api/ai-connections";
import type { ReactElement } from "react";

vi.mock("@/api/ai-connections", () => ({
  aiConnectionsApi: {
    createDeployment: vi.fn(async () => ({
      id: "created",
      companyId: "company",
      connectionId: "connection",
      modelId: "westus-prod",
      displayName: null,
      protocol: "responses",
      status: "stale",
      verifiedCredentialEpoch: 1,
      lastError: null,
      verifiedAt: null,
      createdByUserId: "board",
    })),
    verifyDeployment: vi.fn(async () => ({
      id: "verified",
      companyId: "company",
      connectionId: "connection",
      modelId: "westus-prod",
      displayName: null,
      protocol: "responses",
      status: "verified",
      verifiedCredentialEpoch: 1,
      lastError: null,
      verifiedAt: new Date().toISOString(),
      createdByUserId: "board",
    })),
    deleteDeployment: vi.fn(async () => undefined),
  },
}));

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  return {
    client,
    container,
    async mount() {
      await act(async () => root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>));
    },
    async unmount() {
      await act(async () => root.unmount());
      client.clear();
    },
  };
}

it("lets a manager add, verify, reverify, and remove deployments without exposing base URLs or credentials", async () => {
  const refresh = vi.fn();
  const { container, mount, unmount } = render(
    <AiConnectionDeploymentManager
      companyId="company"
      connectionId="connection"
      grantId="grant"
      canManage
      deployments={[
        {
          id: "verified",
          companyId: "company",
          connectionId: "connection",
          modelId: "azure-prod",
          displayName: "Azure Prod",
          protocol: "responses",
          status: "verified",
          verifiedCredentialEpoch: 1,
          lastError: null,
          verifiedAt: new Date().toISOString(),
          createdByUserId: "board",
        },
        {
          id: "stale",
          companyId: "company",
          connectionId: "connection",
          modelId: "azure-staging",
          displayName: null,
          protocol: "chat",
          status: "stale",
          verifiedCredentialEpoch: 1,
          lastError: null,
          verifiedAt: null,
          createdByUserId: "board",
        },
      ]}
      onRefresh={refresh}
    />,
  );
  try {
    await mount();
    expect(container.textContent).toContain("Verified deployments");
    expect(container.textContent).toContain("Enter the deployment name shown in Azure Portal. Azure OpenAI model catalogs do not identify this resource’s deployments.");
    expect(container.textContent).not.toContain("https://azure.example.com");
    expect(container.textContent).not.toContain("api-key");

    const input = container.querySelector('input[aria-label="Deployment name"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "westus-prod");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Add deployment")?.click());

    expect(aiConnectionsApi.createDeployment).toHaveBeenCalledWith("company", "connection", { modelId: "westus-prod", protocol: "responses" });

    const buttons = Array.from(container.querySelectorAll("button"));
    const verify = buttons.find((button) => button.textContent === "Verify")!;
    const reverify = buttons.find((button) => button.textContent === "Reverify")!;
    const remove = buttons.filter((button) => button.textContent === "Remove")[1]!;
    await act(async () => verify.click());
    await act(async () => reverify.click());
    await act(async () => remove.click());

    expect(aiConnectionsApi.verifyDeployment).toHaveBeenCalledWith("company", "connection", "stale", "grant");
    expect(aiConnectionsApi.verifyDeployment).toHaveBeenCalledWith("company", "connection", "verified", "grant");
    expect(aiConnectionsApi.deleteDeployment).toHaveBeenCalledWith("company", "connection", "stale");
    expect(refresh).toHaveBeenCalled();
  } finally {
    await unmount();
  }
});

it("shows a read-only verified list with no secret fields or actions", async () => {
  const { container, mount, unmount } = render(
    <AiConnectionDeploymentManager
      companyId="company"
      connectionId="connection"
      canManage={false}
      deployments={[
        {
          id: "verified",
          companyId: "company",
          connectionId: "connection",
          modelId: "azure-prod",
          displayName: "Azure Prod",
          protocol: "responses",
          status: "verified",
          verifiedCredentialEpoch: 1,
          lastError: null,
          verifiedAt: new Date().toISOString(),
          createdByUserId: "board",
        },
        {
          id: "failed",
          companyId: "company",
          connectionId: "connection",
          modelId: "azure-failed",
          displayName: null,
          protocol: "chat",
          status: "failed",
          verifiedCredentialEpoch: 1,
          lastError: "Denied",
          verifiedAt: null,
          createdByUserId: "board",
        },
      ]}
    />,
  );
  try {
    await mount();
    expect(container.textContent).toContain("Verified deployments");
    expect(container.textContent).toContain("Azure Prod");
    expect(container.textContent).not.toContain("Deployment name");
    expect(container.textContent).not.toContain("Verify");
    expect(container.textContent).not.toContain("Remove");
    expect(container.textContent).not.toContain("Azure OpenAI model catalogs do not identify this resource’s deployments.");
  } finally {
    await unmount();
  }
});

it("shows empty and error states for deployment loading", async () => {
  const { container, mount, unmount } = render(
    <AiConnectionDeploymentManager
      companyId="company"
      connectionId="connection"
      grantId="grant"
      canManage
      deployments={[]}
      isLoading={false}
      error={new Error("Could not load deployments.")}
      onRetry={vi.fn()}
    />,
  );
  try {
    await mount();
    expect(container.textContent).toContain("Could not load deployments.");
    expect(container.textContent).toContain("Retry");
  } finally {
    await unmount();
  }
});
