// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleProfiles } from "./RoleProfiles";

const mockAgentRoleProfilesApi = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  revisions: vi.fn(),
}));

vi.mock("@/api/agentRoleProfiles", () => ({ agentRoleProfilesApi: mockAgentRoleProfilesApi }));
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));
vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const profiles = [
  {
    id: "system-ceo",
    companyId: "company-1",
    key: "ceo",
    name: "CEO",
    description: "System profile. Existing CEO behavior remains unchanged.",
    kind: "system_ceo" as const,
    readOnly: true,
    revision: {
      id: "system-ceo",
      number: 1,
      managedFiles: { "AGENTS.md": "CEO instructions" },
      changeSummary: "Informational representation of the existing CEO instruction bundle.",
      createdAt: null,
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000001",
    companyId: "company-1",
    key: "researcher",
    name: "Researcher",
    description: "Research role defaults",
    kind: "seeded" as const,
    readOnly: false,
    revision: {
      id: "00000000-0000-4000-8000-000000000002",
      number: 1,
      managedFiles: { "AGENTS.md": "Research instructions", "SOUL.md": "Be curious" },
      changeSummary: null,
      createdAt: "2026-10-24T00:00:00.000Z",
    },
  },
];

async function flushQueries() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("RoleProfiles", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockAgentRoleProfilesApi.list.mockResolvedValue(profiles);
    mockAgentRoleProfilesApi.revisions.mockResolvedValue([]);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it("renders the CEO profile as read-only and selects an editable seeded profile", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <RoleProfiles />
        </QueryClientProvider>,
      );
    });
    await flushQueries();

    expect(container.textContent).toContain("CEO");
    expect(container.textContent).toContain("Existing CEO behavior remains unchanged");
    expect([...container.querySelectorAll("input, textarea")]).toHaveLength(0);

    const researcher = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Researcher"),
    );
    expect(researcher).toBeDefined();
    await act(async () => {
      researcher!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushQueries();

    expect((container.querySelector('input[aria-label="Profile name"]') as HTMLInputElement | null)?.value).toBe("Researcher");
    expect([...container.querySelectorAll('input[aria-label="Managed file path"]')].map((input) => (input as HTMLInputElement).value)).toEqual(["AGENTS.md", "SOUL.md"]);
    expect(container.textContent).toContain("Revision 1");
  });
});
