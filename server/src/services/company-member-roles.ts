import {
  HUMAN_COMPANY_MEMBERSHIP_ROLES,
  HUMAN_COMPANY_ROLE_DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,
} from "@paperclipai/shared";
import type { HumanCompanyMembershipRole } from "@paperclipai/shared";

export function normalizeHumanRole(
  value: unknown,
  fallback: HumanCompanyMembershipRole = "operator"
): HumanCompanyMembershipRole {
  if (value === "member") return "operator";
  return (HUMAN_COMPANY_MEMBERSHIP_ROLES as readonly string[]).includes(value as string)
    ? (value as HumanCompanyMembershipRole)
    : fallback;
}

export function grantsForHumanRole(
  role: HumanCompanyMembershipRole
): Array<{
  permissionKey: (typeof PERMISSION_KEYS)[number];
  scope: Record<string, unknown> | null;
}> {
  return HUMAN_COMPANY_ROLE_DEFAULT_PERMISSIONS[role].map((permissionKey) => ({
    permissionKey,
    scope: null,
  }));
}

export function resolveHumanInviteRole(
  defaultsPayload: Record<string, unknown> | null | undefined
): HumanCompanyMembershipRole {
  if (!defaultsPayload || typeof defaultsPayload !== "object") return "operator";
  const scoped = defaultsPayload.human;
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return "operator";
  }
  return normalizeHumanRole((scoped as Record<string, unknown>).role, "operator");
}
