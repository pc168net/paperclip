// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleProfiles } from "./RoleProfiles";

const mockAgentRoleProfilesApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
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

async function waitFor<T>(assertion: () => T): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    }
  }
  throw lastError;
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
    expect(container.textContent).toContain("AGENTS.md");
    expect(container.textContent).not.toContain("CEO instructions");
    expect(container.querySelector("pre")).toBeNull();
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

  it("shows a contextual loading state while revision history is loading", async () => {
    mockAgentRoleProfilesApi.revisions.mockImplementation((_companyId: string, profileId: string) =>
      profileId === "system-ceo" ? Promise.resolve([]) : new Promise(() => {}),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(<QueryClientProvider client={queryClient}><RoleProfiles /></QueryClientProvider>);
    });
    await flushQueries();

    const researcher = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Researcher"));
    await act(async () => researcher!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushQueries();

    expect(container.textContent).toContain("Loading revision history…");
    expect(container.textContent).not.toContain("Revision history unavailable.");
  });

  it("explains when revision history cannot be loaded", async () => {
    mockAgentRoleProfilesApi.revisions.mockImplementation((_companyId: string, profileId: string) =>
      profileId === "system-ceo" ? Promise.resolve([]) : Promise.reject(new Error("history unavailable")),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(<QueryClientProvider client={queryClient}><RoleProfiles /></QueryClientProvider>);
    });
    await flushQueries();

    const researcher = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Researcher"));
    await act(async () => researcher!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flushQueries();

    expect(container.textContent).toContain("Revision history unavailable.");
    expect(container.textContent).not.toContain("Loading revision history…");
  });

  it("lets the board create a custom Profile and archive an editable Profile", async () => {
    mockAgentRoleProfilesApi.create.mockResolvedValue(profiles[1]);
    mockAgentRoleProfilesApi.archive.mockResolvedValue({ ...profiles[1], archivedAt: "2026-10-24T01:00:00.000Z" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(<QueryClientProvider client={queryClient}><RoleProfiles /></QueryClientProvider>);
    });
    await flushQueries();

    await act(async () => { buttonByText(container, "Create Profile").click(); });
    expect((container.querySelector('input[aria-label="Profile name"]') as HTMLInputElement).value).toBe("New Profile");
    expect(container.textContent).not.toContain("Archive Profile");
    await act(async () => { buttonByText(container, "Save Profile").click(); });
    await waitFor(() => expect(mockAgentRoleProfilesApi.create).toHaveBeenCalledWith("company-1", expect.objectContaining({ name: "New Profile" })));

    await act(async () => { buttonByText(container, "Researcher").click(); });
    await flushQueries();
    await act(async () => { buttonByText(container, "Archive Profile").click(); });
    await waitFor(() => expect(mockAgentRoleProfilesApi.archive).toHaveBeenCalledWith("company-1", profiles[1].id));
    expect(container.textContent).not.toContain("Archive Profile");
  });

  it("cancels a new Profile draft and exits it when an existing Profile is selected", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(<QueryClientProvider client={queryClient}><RoleProfiles /></QueryClientProvider>);
    });
    await flushQueries();

    await act(async () => { buttonByText(container, "Create Profile").click(); });
    expect((container.querySelector('input[aria-label="Profile name"]') as HTMLInputElement).value).toBe("New Profile");

    const cancelButton = container.querySelector('button[aria-label="Cancel new Profile"]') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    await act(async () => { cancelButton!.click(); });
    await flushQueries();
    expect(container.textContent).toContain("Existing CEO behavior remains unchanged");
    expect(container.textContent).not.toContain("Save Profile");

    await act(async () => { buttonByText(container, "Create Profile").click(); });
    await act(async () => { buttonByText(container, "Researcher").click(); });
    await flushQueries();
    expect((container.querySelector('input[aria-label="Profile name"]') as HTMLInputElement).value).toBe("Researcher");
    expect(container.textContent).not.toContain("Save Profile");
  });

  it("exits new Profile mode after a failed creation", async () => {
    mockAgentRoleProfilesApi.create.mockRejectedValue(new Error("create failed"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(<QueryClientProvider client={queryClient}><RoleProfiles /></QueryClientProvider>);
    });
    await flushQueries();

    await act(async () => { buttonByText(container, "Create Profile").click(); });
    await act(async () => { buttonByText(container, "Save Profile").click(); });
    await waitFor(() => expect(mockAgentRoleProfilesApi.create).toHaveBeenCalled());
    await flushQueries();

    expect(container.textContent).toContain("Existing CEO behavior remains unchanged");
    expect(container.textContent).not.toContain("Save Profile");
  });

  it("keeps the selected Profile draft when a pending new Profile creation fails", async () => {
    let rejectCreate: (reason?: unknown) => void = () => {};
    mockAgentRoleProfilesApi.create.mockImplementation(() => new Promise((_, reject) => {
      rejectCreate = reject;
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(container);
    flushSync(() => {
      root!.render(<QueryClientProvider client={queryClient}><RoleProfiles /></QueryClientProvider>);
    });
    await flushQueries();

    await act(async () => { buttonByText(container, "Create Profile").click(); });
    await act(async () => { buttonByText(container, "Save Profile").click(); });
    await waitFor(() => expect(mockAgentRoleProfilesApi.create).toHaveBeenCalled());
    await act(async () => { buttonByText(container, "Researcher").click(); });
    expect((container.querySelector('input[aria-label="Profile name"]') as HTMLInputElement).value).toBe("Researcher");

    await act(async () => { rejectCreate(new Error("create failed")); });
    await flushQueries();

    expect((container.querySelector('input[aria-label="Profile name"]') as HTMLInputElement).value).toBe("Researcher");
    expect(container.textContent).toContain("Archive Profile");
  });
});

function buttonByText(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}
