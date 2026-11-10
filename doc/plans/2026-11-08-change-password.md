# Change Password on Account Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Change password" section to the user profile settings page (`ProfileSettings`) allowing authenticated self-hosted users to change their password via Better Auth.

**Architecture:** Client API extension in `ui/src/api/auth.ts` calling Better Auth's `POST /api/auth/change-password` endpoint, integrated into `ProfileSettings.tsx` as a dedicated card with current/new/confirm password fields and an option to revoke other sessions, gated on authenticated self-hosted instances (`deploymentMode === "authenticated"` and not Cloud).

**Tech Stack:** React, TypeScript, TanStack Query, Radix UI (Checkbox, Card, Button, Input, Label), Lucide icons, Vitest.

**Spec:** [doc/plans/2026-11-08-change-password-design.md](file:///Users/bruce/Antigravity/paperclip/paperclip/doc/plans/2026-11-08-change-password-design.md)

## Global Constraints

- Never use raw px, hex codes, or arbitrary bracket styles in UI components (`DESIGN.md` token-only rule; must pass `pnpm check:token-gates`).
- Better Auth endpoint contract: `POST /api/auth/change-password` with body `{ currentPassword: string, newPassword: string, revokeOtherSessions?: boolean }`.
- Password minimum length is 8 characters.
- Gated: Only visible when `deploymentMode === "authenticated"` and `cloud` is falsy.
- Input types must be `type="password"`.
- Password fields must be cleared upon successful mutation.

## Review Focus

- Empty or whitespace passwords must not submit.
- New password shorter than 8 characters must show client validation error and block submit.
- Mismatched new password and confirmation password must show client validation error and block submit.
- API errors (e.g., incorrect current password) must be captured and shown in an alert banner without losing input in other fields.
- Non-authenticated or Cloud deployments must not render the change password card.

---

### Task 1: API Client — Add `changePassword` to `authApi`

**Files:**
- Modify: `paperclip/ui/src/api/auth.ts`
- Test: `paperclip/ui/src/api/auth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  }
  authApi.changePassword(input: ChangePasswordInput): Promise<void>
  ```

- [ ] **Step 1: Write failing tests in `paperclip/ui/src/api/auth.test.ts`**

Add tests for `authApi.changePassword`:
```ts
describe("authApi.changePassword", () => {
  it("sends POST to /api/auth/change-password with credentials and JSON payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await authApi.changePassword({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      revokeOtherSessions: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: "old-password",
          newPassword: "new-password-123",
          revokeOtherSessions: true,
        }),
      }),
    );
  });

  it("throws AuthApiError when the request fails with 400/401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      authApi.changePassword({
        currentPassword: "wrong",
        newPassword: "new-password-123",
      }),
    ).rejects.toThrow("Invalid password");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @paperclipai/ui test src/api/auth.test.ts`
Expected: FAIL with `authApi.changePassword is not a function`

- [ ] **Step 3: Implement `changePassword` in `paperclip/ui/src/api/auth.ts`**

Export `ChangePasswordInput` interface and add `changePassword` method in `authApi`:
```ts
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}
```
Inside `authApi`:
```ts
  changePassword: async (input: ChangePasswordInput): Promise<void> => {
    await authPost("/change-password", input as Record<string, unknown>);
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @paperclipai/ui test src/api/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/auth.ts ui/src/api/auth.test.ts
git commit -m "feat(ui): add changePassword method to authApi"
```

---

### Task 2: UI Implementation — Add Change Password Form to `ProfileSettings`

**Files:**
- Modify: `paperclip/ui/src/pages/ProfileSettings.tsx`

**Interfaces:**
- Consumes: `authApi.changePassword` from `paperclip/ui/src/api/auth.ts`, `healthApi.get` from `paperclip/ui/src/api/health.ts`

- [ ] **Step 1: Check gating and add query for instance health in `ProfileSettings.tsx`**

Add `healthQuery` via `healthApi.get()`:
```ts
const healthQuery = useQuery({
  queryKey: queryKeys.health,
  queryFn: () => healthApi.get(),
  retry: false,
});
const showPasswordChange = healthQuery.data?.deploymentMode === "authenticated" && !healthQuery.data?.cloud;
```

- [ ] **Step 2: Add state and mutation for change password**

State variables:
- `currentPassword`: string
- `newPassword`: string
- `confirmPassword`: string
- `revokeOtherSessions`: boolean (default `true`)
- `passwordError`: string | null
- `passwordSuccess`: string | null

Mutation:
```ts
const changePasswordMutation = useMutation({
  mutationFn: async () => {
    setPasswordError(null);
    setPasswordSuccess(null);
    if (!currentPassword) {
      throw new Error("Current password is required.");
    }
    if (newPassword.length < 8) {
      throw new Error("New password must be at least 8 characters long.");
    }
    if (newPassword !== confirmPassword) {
      throw new Error("New passwords do not match.");
    }
    await authApi.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions,
    });
  },
  onSuccess: () => {
    setPasswordError(null);
    setPasswordSuccess("Password changed successfully.");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  },
  onError: (err) => {
    setPasswordSuccess(null);
    setPasswordError(err instanceof Error ? err.message : "Failed to change password.");
  },
});
```

- [ ] **Step 3: Render the Change Password card in JSX**

Render the `<Card>` when `showPasswordChange` is true:
- Title: "Change password" with `KeyRound` or `Lock` icon.
- Description: "Update your account password. Choose a secure password with at least 8 characters."
- Success banner: Green alert when `passwordSuccess` is set.
- Error banner: Destructive alert when `passwordError` is set.
- Form inputs:
  - Current password: `id="current-password"`, `type="password"`, `autoComplete="current-password"`, value bound to `currentPassword`.
  - New password: `id="new-password"`, `type="password"`, `autoComplete="new-password"`, value bound to `newPassword`.
  - Confirm new password: `id="confirm-password"`, `type="password"`, `autoComplete="new-password"`, value bound to `confirmPassword`.
  - Revoke other sessions: `<Checkbox id="revoke-sessions" checked={revokeOtherSessions} onCheckedChange={(val) => setRevokeOtherSessions(val === true)} />` with Label "Sign out of other sessions".
- Form footer:
  - Submit button: `disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword}`
  - Text: `changePasswordMutation.isPending ? "Updating password..." : "Update password"`

- [ ] **Step 4: Verify token rules**

Run: `node scripts/check-token-gates.mjs`
Expected: PASS (zero token gate violations).

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/ProfileSettings.tsx
git commit -m "feat(ui): add change password section to profile settings"
```

---

### Task 3: Unit Testing — Test `ProfileSettings` Change Password Flows

**Files:**
- Modify: `paperclip/ui/src/pages/ProfileSettings.test.tsx`

**Interfaces:**
- Consumes: `ProfileSettings` component, mock `authApi.changePassword`, mock `healthApi.get`

- [ ] **Step 1: Update test mocks in `ProfileSettings.test.tsx`**

- Add `changePassword: vi.fn()` to `mockAuthApi`.
- Add `mockHealthApi = vi.hoisted(() => ({ get: vi.fn() }))` and `vi.mock("@/api/health", () => ({ healthApi: mockHealthApi }))`.
- Set default `mockHealthApi.get.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" })`.

- [ ] **Step 2: Add test cases for password change**

1. `renders change password form in authenticated self-hosted deployment`:
   - Checks that inputs for current password, new password, confirm password, and revoke other sessions exist.
2. `hides change password form when deploymentMode is local_trusted or cloud`:
   - Sets `deploymentMode: "local_trusted"`, verifies password inputs are not rendered.
   - Sets `deploymentMode: "authenticated", cloud: { enabled: true }`, verifies password inputs are not rendered.
3. `validates password mismatch before calling API`:
   - Inputs current password, new password "password123", confirm password "different456".
   - Submits form.
   - Verifies error "New passwords do not match." is shown.
   - Verifies `mockAuthApi.changePassword` was NOT called.
4. `validates password length (< 8 chars)`:
   - Inputs current password, new password "short", confirm password "short".
   - Submits form.
   - Verifies error "New password must be at least 8 characters long." is shown.
   - Verifies `mockAuthApi.changePassword` was NOT called.
5. `submits change password successfully and clears fields`:
   - Inputs current password "oldpass123", new password "newsecret456", confirm "newsecret456".
   - Submits form.
   - Verifies `mockAuthApi.changePassword` called with `{ currentPassword: "oldpass123", newPassword: "newsecret456", revokeOtherSessions: true }`.
   - Verifies success message is rendered.
   - Verifies inputs are cleared.
6. `handles API errors gracefully`:
   - `mockAuthApi.changePassword.mockRejectedValueOnce(new Error("Invalid current password"))`.
   - Submits form.
   - Verifies error "Invalid current password" is displayed.

- [ ] **Step 3: Run tests and verify they pass**

Run: `pnpm --filter @paperclipai/ui test src/pages/ProfileSettings.test.tsx`
Expected: All tests PASS.

- [ ] **Step 4: Run full verification**

Run:
```bash
node scripts/check-token-gates.mjs
pnpm --filter @paperclipai/ui typecheck
pnpm --filter @paperclipai/ui test
```
Expected: All checks PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/ProfileSettings.test.tsx
git commit -m "test(ui): add comprehensive tests for profile change password"
```
