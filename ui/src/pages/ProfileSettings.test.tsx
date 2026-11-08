// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeAssetNamespace } from "@paperclipai/shared";
import { ProfileSettings } from "./ProfileSettings";

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
}));

const mockHealthApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

const mockAssetsApi = vi.hoisted(() => ({
  uploadImage: vi.fn(),
  uploadCompanyLogo: vi.fn(),
}));

const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("@/api/health", () => ({
  healthApi: mockHealthApi,
}));

vi.mock("@/api/assets", () => ({
  assetsApi: mockAssetsApi,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: mockSetBreadcrumbs,
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip", issuePrefix: "PAP" },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

const inputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)?.set;

function setInputValue(input: HTMLInputElement, value: string) {
  inputValueSetter!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ProfileSettings", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);

    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        name: "Jane Example",
        email: "jane@example.com",
        image: "https://example.com/jane.png",
      },
    });
    mockAssetsApi.uploadImage.mockResolvedValue({
      assetId: "asset-1",
      contentPath: "/api/assets/asset-1/content",
    });
    mockAuthApi.updateProfile.mockImplementation(async (input: { name: string; image: string | null }) => ({
      id: "user-1",
      name: input.name,
      email: "jane@example.com",
      image: input.image,
    }));
    mockHealthApi.get.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
    });
    mockAuthApi.changePassword.mockResolvedValue(undefined);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("does not render a keyboard shortcuts toggle because shortcuts are always enabled", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();
    expect(container.textContent).toContain("Jane Example");
    expect(container.textContent).not.toContain("Keyboard shortcuts");
    expect(container.querySelector('[aria-label="Toggle keyboard shortcuts"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("uploads a clicked avatar into Paperclip storage and persists the returned asset path", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProfileSettings />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).not.toContain("Avatar image URL");

    const avatarInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(avatarInput).not.toBeNull();

    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    Object.defineProperty(avatarInput, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      avatarInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    await flushReact();

    expect(mockAssetsApi.uploadImage).toHaveBeenCalledWith("company-1", file, "profiles/user-1");
    expect(mockAuthApi.updateProfile).toHaveBeenCalledWith({
      name: "Jane Example",
      image: "/api/assets/asset-1/content",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("uploads an avatar for a user id that comes from an identity provider", async () => {
    const userId = "oidc:example|jane.example@example.com";
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId },
      user: {
        id: userId,
        name: "Jane Example",
        email: "jane@example.com",
        image: "https://example.com/jane.png",
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProfileSettings />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const avatarInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(avatarInput).not.toBeNull();

    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    Object.defineProperty(avatarInput, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      avatarInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    await flushReact();

    const namespace = `profiles/${userId}`;
    expect(mockAssetsApi.uploadImage).toHaveBeenCalledWith("company-1", file, namespace);
    // The namespace goes to the API without a change, so the avatar arrives
    // under the identity of the user.
    expect(sanitizeAssetNamespace(namespace)).toBe(namespace);
    expect(mockAuthApi.updateProfile).toHaveBeenCalledWith({
      name: "Jane Example",
      image: "/api/assets/asset-1/content",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("renders change password form in authenticated self-hosted deployment", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    expect(container.textContent).toContain("Change password");
    expect(container.querySelector("#current-password")).not.toBeNull();
    expect(container.querySelector("#new-password")).not.toBeNull();
    expect(container.querySelector("#confirm-password")).not.toBeNull();
    expect(container.querySelector("#revoke-other-sessions")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("hides change password form when deploymentMode is local_trusted or cloud", async () => {
    mockHealthApi.get.mockResolvedValueOnce({
      status: "ok",
      deploymentMode: "local_trusted",
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    expect(container.querySelector("#current-password")).toBeNull();
    expect(container.textContent).not.toContain("Change password");

    await act(async () => {
      root.unmount();
    });

    mockHealthApi.get.mockResolvedValueOnce({
      status: "ok",
      deploymentMode: "authenticated",
      cloud: { enabled: true },
    });

    const rootCloud = createRoot(container);
    const queryClientCloud = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      rootCloud.render(<QueryClientProvider client={queryClientCloud}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    expect(container.querySelector("#current-password")).toBeNull();

    await act(async () => {
      rootCloud.unmount();
    });
  });

  it("validates password mismatch before calling API", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    const currentInput = container.querySelector("#current-password") as HTMLInputElement;
    const newInput = container.querySelector("#new-password") as HTMLInputElement;
    const confirmInput = container.querySelector("#confirm-password") as HTMLInputElement;

    await act(async () => {
      setInputValue(currentInput, "current-secret");
      setInputValue(newInput, "new-secret-123");
      setInputValue(confirmInput, "different-secret-456");
    });

    const passwordForm = currentInput.closest("form") as HTMLFormElement;
    await act(async () => {
      passwordForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("New passwords do not match.");
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("validates password length (< 8 chars)", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    const currentInput = container.querySelector("#current-password") as HTMLInputElement;
    const newInput = container.querySelector("#new-password") as HTMLInputElement;
    const confirmInput = container.querySelector("#confirm-password") as HTMLInputElement;

    await act(async () => {
      setInputValue(currentInput, "current-secret");
      setInputValue(newInput, "short");
      setInputValue(confirmInput, "short");
    });

    const passwordForm = currentInput.closest("form") as HTMLFormElement;
    await act(async () => {
      passwordForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("New password must be at least 8 characters long.");
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("submits change password successfully and clears fields", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    const currentInput = container.querySelector("#current-password") as HTMLInputElement;
    const newInput = container.querySelector("#new-password") as HTMLInputElement;
    const confirmInput = container.querySelector("#confirm-password") as HTMLInputElement;

    await act(async () => {
      setInputValue(currentInput, "current-secret");
      setInputValue(newInput, "brand-new-secret-123");
      setInputValue(confirmInput, "brand-new-secret-123");
    });

    const passwordForm = currentInput.closest("form") as HTMLFormElement;
    await act(async () => {
      passwordForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();

    expect(mockAuthApi.changePassword).toHaveBeenCalledWith({
      currentPassword: "current-secret",
      newPassword: "brand-new-secret-123",
      revokeOtherSessions: true,
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Password changed successfully.");
    expect(currentInput.value).toBe("");
    expect(newInput.value).toBe("");
    expect(confirmInput.value).toBe("");

    await act(async () => {
      root.unmount();
    });
  });

  it("handles API errors gracefully", async () => {
    mockAuthApi.changePassword.mockRejectedValueOnce(new Error("Incorrect current password."));

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><ProfileSettings /></QueryClientProvider>);
    });
    await flushReact();

    const currentInput = container.querySelector("#current-password") as HTMLInputElement;
    const newInput = container.querySelector("#new-password") as HTMLInputElement;
    const confirmInput = container.querySelector("#confirm-password") as HTMLInputElement;

    await act(async () => {
      setInputValue(currentInput, "wrong-pass");
      setInputValue(newInput, "brand-new-secret-123");
      setInputValue(confirmInput, "brand-new-secret-123");
    });

    const passwordForm = currentInput.closest("form") as HTMLFormElement;
    await act(async () => {
      passwordForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Incorrect current password.");

    await act(async () => {
      root.unmount();
    });
  });
});
