import { foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AgentRoleProfileKind, AgentRoleProfileManagedFiles } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const agentRoleProfiles = pgTable("agent_role_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind").$type<AgentRoleProfileKind>().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  identity: unique("agent_role_profiles_company_id_uq").on(table.companyId, table.id),
  key: unique("agent_role_profiles_company_key_uq").on(table.companyId, table.key),
  companyName: unique("agent_role_profiles_company_name_uq").on(table.companyId, table.name),
}));

export const agentRoleProfileRevisions = pgTable("agent_role_profile_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  managedFiles: jsonb("managed_files").$type<AgentRoleProfileManagedFiles>().notNull(),
  changeSummary: text("change_summary"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  profile: foreignKey({ columns: [table.companyId, table.profileId], foreignColumns: [agentRoleProfiles.companyId, agentRoleProfiles.id] }).onDelete("cascade"),
  identity: unique("agent_role_profile_revisions_company_id_uq").on(table.companyId, table.id),
  revision: unique("agent_role_profile_revisions_profile_revision_uq").on(table.profileId, table.revisionNumber),
  profileHistory: index("agent_role_profile_revisions_profile_idx").on(table.companyId, table.profileId, table.revisionNumber),
}));

export const agentRoleProfileAdoptions = pgTable("agent_role_profile_adoptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  appliedRevisionId: uuid("applied_revision_id").notNull(),
  managedPaths: jsonb("managed_paths").$type<string[]>().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agent: foreignKey({ columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("cascade"),
  profile: foreignKey({ columns: [table.companyId, table.profileId], foreignColumns: [agentRoleProfiles.companyId, agentRoleProfiles.id] }).onDelete("cascade"),
  revision: foreignKey({ columns: [table.companyId, table.appliedRevisionId], foreignColumns: [agentRoleProfileRevisions.companyId, agentRoleProfileRevisions.id] }).onDelete("restrict"),
  agentIdentity: unique("agent_role_profile_adoptions_agent_uq").on(table.agentId),
  companyAgent: unique("agent_role_profile_adoptions_company_agent_uq").on(table.companyId, table.agentId),
  profileUse: index("agent_role_profile_adoptions_profile_idx").on(table.companyId, table.profileId),
}));
