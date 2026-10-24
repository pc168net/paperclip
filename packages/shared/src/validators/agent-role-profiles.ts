import { z } from "zod";

export const AGENT_ROLE_PROFILE_KINDS = ["system_ceo", "seeded", "custom"] as const;
export const agentRoleProfileKindSchema = z.enum(AGENT_ROLE_PROFILE_KINDS);

function isSafeManagedInstructionPath(value: string) {
  if (value.length === 0 || value.length > 512 || value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const agentRoleProfileManagedFilesSchema = z
  .record(z.string(), z.string().max(1024 * 1024))
  .refine((files) => Object.keys(files).length > 0, "managedFiles must contain at least one file")
  .refine((files) => "AGENTS.md" in files, "managedFiles must contain AGENTS.md")
  .superRefine((files, context) => {
    for (const path of Object.keys(files)) {
      if (!isSafeManagedInstructionPath(path)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: "Managed file path must be a safe relative path" });
      }
    }
  });

const roleProfileFields = {
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(2_000).nullable().optional(),
  managedFiles: agentRoleProfileManagedFilesSchema,
  changeSummary: z.string().trim().max(1_000).nullable().optional(),
};

export const createAgentRoleProfileSchema = z.object(roleProfileFields).strict();
export const updateAgentRoleProfileSchema = z.object(roleProfileFields).strict();
export const applyAgentRoleProfileSchema = z.object({
  roleProfileId: z.string().uuid(),
  roleProfileRevisionId: z.string().uuid().optional(),
}).strict();
export const restoreAgentRoleProfileSchema = z.object({
  roleProfileRevisionId: z.string().uuid().optional(),
  confirm: z.literal(true),
}).strict();

export type AgentRoleProfileKind = z.infer<typeof agentRoleProfileKindSchema>;
export type AgentRoleProfileManagedFiles = z.infer<typeof agentRoleProfileManagedFilesSchema>;
export type CreateAgentRoleProfile = z.infer<typeof createAgentRoleProfileSchema>;
export type UpdateAgentRoleProfile = z.infer<typeof updateAgentRoleProfileSchema>;
export type ApplyAgentRoleProfile = z.infer<typeof applyAgentRoleProfileSchema>;
export type RestoreAgentRoleProfile = z.infer<typeof restoreAgentRoleProfileSchema>;
