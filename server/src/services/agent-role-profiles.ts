import { randomUUID } from "node:crypto";
import { AGENT_ROLE_LABELS, AGENT_ROLES, type CreateAgentRoleProfile, type UpdateAgentRoleProfile } from "@paperclipai/shared";
import { activityLog, agentRoleProfileRevisions, agentRoleProfiles, type Db } from "@paperclipai/db";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { forbidden, notFound } from "../errors.js";
import { loadDefaultAgentInstructionsBundle } from "./default-agent-instructions.js";

const SYSTEM_CEO_PROFILE_ID = "system-ceo";
type BoardActor = { userId?: string | null };

export function agentRoleProfileService(db: Db) {
  async function ensureSeededProfiles(companyId: string) {
    const defaults = await loadDefaultAgentInstructionsBundle("default");
    await db.transaction(async (tx) => {
      for (const role of AGENT_ROLES.filter((role) => role !== "ceo")) {
        const [profile] = await tx.insert(agentRoleProfiles).values({
          companyId, key: role, name: AGENT_ROLE_LABELS[role], kind: "seeded",
        }).onConflictDoNothing().returning();
        if (profile) await tx.insert(agentRoleProfileRevisions).values({
          companyId, profileId: profile.id, revisionNumber: 1, managedFiles: defaults,
        });
      }
    });
  }

  async function latestRevision(companyId: string, profileId: string) {
    const [revision] = await db.select().from(agentRoleProfileRevisions)
      .where(and(eq(agentRoleProfileRevisions.companyId, companyId), eq(agentRoleProfileRevisions.profileId, profileId)))
      .orderBy(desc(agentRoleProfileRevisions.revisionNumber)).limit(1);
    if (!revision) throw notFound("Role Profile revision not found");
    return revision;
  }

  async function list(companyId: string) {
    await ensureSeededProfiles(companyId);
    const rows = await db.select().from(agentRoleProfiles)
      .where(and(eq(agentRoleProfiles.companyId, companyId), isNull(agentRoleProfiles.archivedAt)))
      .orderBy(agentRoleProfiles.name);
    const profiles = await Promise.all(rows.map(async (profile) => {
      const revision = await latestRevision(companyId, profile.id);
      return { ...profile, readOnly: false, revision: { id: revision.id, number: revision.revisionNumber, managedFiles: revision.managedFiles, createdAt: revision.createdAt } };
    }));
    const ceoFiles = await loadDefaultAgentInstructionsBundle("ceo");
    return [{
      id: SYSTEM_CEO_PROFILE_ID, companyId, key: "ceo", name: "CEO", description: "System profile. Existing CEO behavior remains unchanged.",
      kind: "system_ceo" as const, readOnly: true, revision: { id: SYSTEM_CEO_PROFILE_ID, number: 1, managedFiles: ceoFiles, createdAt: null },
    }, ...profiles];
  }

  async function create(companyId: string, input: CreateAgentRoleProfile, actor: BoardActor) {
    const result = await db.transaction(async (tx) => {
      const [profile] = await tx.insert(agentRoleProfiles).values({
        companyId, key: `custom-${randomUUID()}`, name: input.name, description: input.description ?? null,
        kind: "custom", createdByUserId: actor.userId ?? null,
      }).returning();
      const [revision] = await tx.insert(agentRoleProfileRevisions).values({
        companyId, profileId: profile!.id, revisionNumber: 1, managedFiles: input.managedFiles,
        changeSummary: input.changeSummary ?? null, createdByUserId: actor.userId ?? null,
      }).returning();
      await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId ?? "board", action: "agent_role_profile.created", entityType: "agent_role_profile", entityId: profile!.id });
      return { ...profile!, readOnly: false, revision: { id: revision!.id, number: revision!.revisionNumber, managedFiles: revision!.managedFiles, createdAt: revision!.createdAt } };
    });
    return result;
  }

  async function update(companyId: string, profileId: string, input: UpdateAgentRoleProfile, actor: BoardActor) {
    if (profileId === SYSTEM_CEO_PROFILE_ID) throw forbidden("The CEO Role Profile is read-only");
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(agentRoleProfiles).where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, profileId))).for("update");
      if (!existing) throw notFound("Role Profile not found");
      const [current] = await tx.select({ number: max(agentRoleProfileRevisions.revisionNumber) }).from(agentRoleProfileRevisions)
        .where(and(eq(agentRoleProfileRevisions.companyId, companyId), eq(agentRoleProfileRevisions.profileId, profileId)));
      const [profile] = await tx.update(agentRoleProfiles).set({ name: input.name, description: input.description ?? null, updatedAt: new Date() })
        .where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, profileId))).returning();
      const [revision] = await tx.insert(agentRoleProfileRevisions).values({ companyId, profileId, revisionNumber: (current?.number ?? 0) + 1,
        managedFiles: input.managedFiles, changeSummary: input.changeSummary ?? null, createdByUserId: actor.userId ?? null }).returning();
      await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId ?? "board", action: "agent_role_profile.updated", entityType: "agent_role_profile", entityId: profileId });
      return { ...profile!, readOnly: false, revision: { id: revision!.id, number: revision!.revisionNumber, managedFiles: revision!.managedFiles, createdAt: revision!.createdAt } };
    });
  }

  return { ensureSeededProfiles, list, create, update, latestRevision };
}
