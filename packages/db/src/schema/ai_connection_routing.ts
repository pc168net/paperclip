import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AiConnectionPoolConfig, AiConnectionRouterSelection, AiDeploymentStatus } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { toolConnections } from "./tool_access.js";

export const aiConnectionPools = pgTable("ai_connection_pools", {
  id: uuid("id").primaryKey().references(() => toolConnections.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  pluginKey: text("plugin_key").notNull(),
  config: jsonb("config").$type<AiConnectionPoolConfig>().notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("ai_connection_pools_company_id_uq").on(table.companyId, table.id),
  foreignKey({ columns: [table.companyId, table.id], foreignColumns: [toolConnections.companyId, toolConnections.id], name: "ai_connection_pools_company_connection_fk" }).onDelete("cascade"),
]);
export const aiConnectionRouterCursors = pgTable("ai_connection_router_cursors", {
  poolId: uuid("pool_id").primaryKey().references(() => aiConnectionPools.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  lastMemberId: text("last_member_id"),
  version: integer("version").notNull().default(0),
}, (table) => [foreignKey({ columns: [table.companyId, table.poolId], foreignColumns: [aiConnectionPools.companyId, aiConnectionPools.id], name: "ai_connection_router_cursors_company_pool_fk" }).onDelete("cascade")]);
export const aiConnectionTaskPins = pgTable("ai_connection_task_pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  poolId: uuid("pool_id").notNull().references(() => aiConnectionPools.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  selection: jsonb("selection").$type<AiConnectionRouterSelection>().notNull(),
  member: jsonb("member").$type<AiConnectionPoolConfig["members"][number]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_connection_task_pins_affinity_uq").on(table.companyId, table.poolId, table.agentId, table.taskKey),
  foreignKey({ columns: [table.companyId, table.poolId], foreignColumns: [aiConnectionPools.companyId, aiConnectionPools.id], name: "ai_connection_task_pins_company_pool_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.companyId, table.agentId], foreignColumns: [agents.companyId, agents.id], name: "ai_connection_task_pins_company_agent_fk" }).onDelete("cascade"),
]);

/** Explicit deployable model metadata; endpoint catalogs are not deployment authority. */
export const aiDeployments = pgTable("ai_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => toolConnections.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  displayName: text("display_name"),
  protocol: text("protocol").$type<"responses" | "chat">().notNull(),
  status: text("status").$type<AiDeploymentStatus>().notNull().default("stale"),
  verifiedCredentialEpoch: integer("verified_credential_epoch").notNull().default(1),
  lastError: text("last_error"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("ai_deployments_company_connection_model_protocol_uq").on(table.companyId, table.connectionId, table.modelId, table.protocol),
  unique("ai_deployments_company_id_uq").on(table.companyId, table.id),
  foreignKey({ columns: [table.companyId, table.connectionId], foreignColumns: [toolConnections.companyId, toolConnections.id], name: "ai_deployments_company_connection_fk" }).onDelete("cascade"),
  check("ai_deployments_status_check", sql`${table.status} in ('stale', 'verified', 'failed')`),
  check("ai_deployments_protocol_check", sql`${table.protocol} in ('responses', 'chat')`),
]);
