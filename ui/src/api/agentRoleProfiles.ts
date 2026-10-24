import type {
  AgentRoleProfileKind,
  AgentRoleProfileManagedFiles,
  CreateAgentRoleProfile,
  UpdateAgentRoleProfile,
} from "@paperclipai/shared";
import { api } from "./client";

export type AgentRoleProfileRevision = {
  id: string;
  number: number;
  managedFiles: AgentRoleProfileManagedFiles;
  changeSummary: string | null;
  createdAt: string | Date | null;
};

export type AgentRoleProfile = {
  id: string;
  companyId: string;
  key: string;
  name: string;
  description: string | null;
  kind: AgentRoleProfileKind;
  readOnly: boolean;
  revision: AgentRoleProfileRevision;
};

export type ArchivedAgentRoleProfile = Omit<AgentRoleProfile, "revision"> & {
  archivedAt: string | Date | null;
};

export const agentRoleProfilesApi = {
  list: (companyId: string) =>
    api.get<AgentRoleProfile[]>(`/companies/${encodeURIComponent(companyId)}/agent-role-profiles`),
  create: (companyId: string, payload: CreateAgentRoleProfile) =>
    api.post<AgentRoleProfile>(`/companies/${encodeURIComponent(companyId)}/agent-role-profiles`, payload),
  update: (companyId: string, profileId: string, payload: UpdateAgentRoleProfile) =>
    api.put<AgentRoleProfile>(
      `/companies/${encodeURIComponent(companyId)}/agent-role-profiles/${encodeURIComponent(profileId)}`,
      payload,
    ),
  archive: (companyId: string, profileId: string) =>
    api.post<ArchivedAgentRoleProfile>(
      `/companies/${encodeURIComponent(companyId)}/agent-role-profiles/${encodeURIComponent(profileId)}/archive`,
      {},
    ),
  revisions: (companyId: string, profileId: string) =>
    api.get<AgentRoleProfileRevision[]>(
      `/companies/${encodeURIComponent(companyId)}/agent-role-profiles/${encodeURIComponent(profileId)}/revisions`,
    ),
  revision: (companyId: string, profileId: string, revisionId: string) =>
    api.get<AgentRoleProfileRevision>(
      `/companies/${encodeURIComponent(companyId)}/agent-role-profiles/${encodeURIComponent(profileId)}/revisions/${encodeURIComponent(revisionId)}`,
    ),
};
