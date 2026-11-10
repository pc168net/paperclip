# Change Password on Account Profile Design

**Date**: 2026-11-08  
**Topic**: Change password functionality on user profile settings (`ProfileSettings`)

## 1. Intent & Why

Users authenticating via username/password on self-hosted Paperclip instances currently have no in-app mechanism to change their account password once registered. Providing a change password form directly on the user profile settings page (`/company/settings/instance/profile`) allows users to manage their credential security without manual administrative database interventions.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Allow authenticated users to change their password on the `ProfileSettings` page.
- Require current password verification to prevent unauthorized changes from unattended active sessions.
- Enforce standard password length requirements (minimum 8 characters, matching the sign-up policy).
- Provide an option to revoke/sign out other active sessions when the password is changed.
- Display clean, accessible status and feedback (loading, success, error) adhering to `DESIGN.md` design token rules.
- Only display the password change section when the instance is operating in self-hosted authenticated mode (`deploymentMode === "authenticated"` and not Cloud-hosted).

### Non-Goals
- Password reset via email / forgot password workflows (not configured in standard self-hosted v1 setup).
- Password change for Cloud instances (managed by external Cloud identity provider).
- Modifying passwords for other users (administrative password reset).

### Anti-Goals
- Bypassing Better Auth verification or creating ad-hoc custom password hashing/updating mechanisms that bypass Better Auth's `account` table management.
- Breaking the existing `ProfileSettings` profile (avatar / display name) update flow.

## 3. Constraints
- **Better Auth Integration**: Must leverage Better Auth's built-in `POST /api/auth/change-password` endpoint.
- **Design System Tokens**: Strictly adhere to `DESIGN.md` tokens (no raw hex, no raw px, use semantic colors and radius tokens). Run `pnpm check:token-gates` cleanly.
- **Security**: Current password required; input types must be `type="password"`; clear fields upon successful submission.

## 4. Approaches Considered

1. **Modal / Dialog Popup**:
   - *Pros*: Keeps the profile page compact.
   - *Cons*: Additional interaction layer; Better Auth profile settings pages generally keep direct settings inline or within structured cards.
2. **Dedicated Card on `ProfileSettings` Page (Chosen)**:
   - *Pros*: Follows the design pattern of other settings sections (e.g., avatar card, inbox agent policy card); easily accessible, straightforward form validation, natural place alongside account settings.
   - *Cons*: Takes up vertical space on the profile page, but manageable with card separation.

## 5. System Design & Contracts

### 5.1 API Client (`paperclip/ui/src/api/auth.ts`)
Add `changePassword` method:
```ts
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
}

// In authApi:
changePassword: async (input: ChangePasswordInput): Promise<void> => {
  await authPost("/change-password", input);
}
```

### 5.2 UI Component (`paperclip/ui/src/pages/ProfileSettings.tsx`)
- Render a `<Card>` titled "Change password" below the profile form and before `InboxAgentPolicyControl`.
- Gate visibility:
  ```tsx
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const showPasswordChange = healthQuery.data?.deploymentMode === "authenticated" && !healthQuery.data?.cloud;
  ```
- Form fields:
  - `currentPassword`: Input `type="password"`, `autoComplete="current-password"`, required.
  - `newPassword`: Input `type="password"`, `autoComplete="new-password"`, minLength 8, required.
  - `confirmPassword`: Input `type="password"`, `autoComplete="new-password"`, required.
  - `revokeOtherSessions`: Checkbox (default checked).
- Client validation:
  - Required fields present.
  - `newPassword.length >= 8`.
  - `newPassword === confirmPassword`.
- Submission & State:
  - Mutation using `useMutation` calling `authApi.changePassword`.
  - Pending state disables submit button and displays loading spinner.
  - Error state displays error alert message.
  - Success state displays success notification and resets password fields.

## 6. Verification
- `ProfileSettings.test.tsx`:
  - Verify password change section renders when `deploymentMode === "authenticated"` and `cloud` is falsy.
  - Verify password change section is hidden when `deploymentMode !== "authenticated"` or `cloud` is true.
  - Verify validation error when `newPassword !== confirmPassword`.
  - Verify validation error when `newPassword.length < 8`.
  - Verify successful password submission calls `authApi.changePassword` with expected payload.
  - Verify error handling from API failure.
- Token gate check: `pnpm check:token-gates`.
- Typecheck: `pnpm -r typecheck`.
- Unit test suite: `pnpm test`.
