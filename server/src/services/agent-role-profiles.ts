import { randomUUID } from "node:crypto";
import { AGENT_ROLE_LABELS, AGENT_ROLES, isUuidLike, type CreateAgentRoleProfile, type UpdateAgentRoleProfile } from "@paperclipai/shared";
import { activityLog, agentRoleProfileAdoptions, agentRoleProfileRevisions, agentRoleProfiles, type Db } from "@paperclipai/db";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { isUniqueViolation } from "../db-errors.js";
import { loadDefaultAgentInstructionsBundle } from "./default-agent-instructions.js";
import { instructionPath } from "./agent-instruction-files.js";

const SYSTEM_CEO_PROFILE_ID = "system-ceo";
type BoardActor = { userId?: string | null };

function assertProfileId(profileId: string) {
  if (profileId !== SYSTEM_CEO_PROFILE_ID && (profileId.trim() !== profileId || !isUuidLike(profileId))) {
    throw badRequest("Invalid role profile id");
  }
}

function assertRevisionId(revisionId: string) {
  if (revisionId.trim() !== revisionId || !isUuidLike(revisionId)) throw badRequest("Invalid role profile revision id");
}

function validateManagedFiles(managedFiles: CreateAgentRoleProfile["managedFiles"]) {
  for (const filePath of Object.keys(managedFiles)) instructionPath(filePath);
  return managedFiles;
}

export function agentRoleProfileService(db: Db) {
  async function ensureSeededProfiles(companyId: string) {
    const defaults = await loadDefaultAgentInstructionsBundle("default");
    await db.transaction(async (tx) => {
      for (const role of AGENT_ROLES.filter((role) => role !== "ceo")) {
        const [sameName] = await tx.select({ id: agentRoleProfiles.id, key: agentRoleProfiles.key }).from(agentRoleProfiles)
          .where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.name, AGENT_ROLE_LABELS[role])))
          .for("update");
        if (sameName && sameName.key !== role) {
          await tx.update(agentRoleProfiles).set({
            name: `${AGENT_ROLE_LABELS[role]} (custom ${sameName.id})`,
            updatedAt: new Date(),
          }).where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, sameName.id)));
        }
        const [profile] = await tx.insert(agentRoleProfiles).values({
          companyId, key: role, name: AGENT_ROLE_LABELS[role], kind: "seeded",
        }).onConflictDoNothing({ target: [agentRoleProfiles.companyId, agentRoleProfiles.key] }).returning();
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

  async function ceoRevision(companyId: string) {
    const managedFiles = await loadDefaultAgentInstructionsBundle("ceo");
    return {
      id: SYSTEM_CEO_PROFILE_ID,
      companyId,
      profileId: SYSTEM_CEO_PROFILE_ID,
      revisionNumber: 1,
      managedFiles,
      changeSummary: "Informational representation of the existing CEO instruction bundle.",
      createdAt: null,
    };
  }

  function publicRevision(revision: Awaited<ReturnType<typeof latestRevision>>) {
    return {
      id: revision.id,
      number: revision.revisionNumber,
      managedFiles: revision.managedFiles,
      changeSummary: revision.changeSummary,
      createdAt: revision.createdAt,
    };
  }

  async function list(companyId: string) {
    await ensureSeededProfiles(companyId);
    const rows = await db.select().from(agentRoleProfiles)
      .where(and(eq(agentRoleProfiles.companyId, companyId), isNull(agentRoleProfiles.archivedAt)))
      .orderBy(agentRoleProfiles.name);
    const profiles = await Promise.all(rows.map(async (profile) => {
      const revision = await latestRevision(companyId, profile.id);
      return { ...profile, readOnly: false, revision: publicRevision(revision) };
    }));
    const revision = await ceoRevision(companyId);
    return [{
      id: SYSTEM_CEO_PROFILE_ID, companyId, key: "ceo", name: "CEO", description: "System profile. Existing CEO behavior remains unchanged.",
      kind: "system_ceo" as const, readOnly: true, revision: { id: revision.id, number: revision.revisionNumber, managedFiles: revision.managedFiles, changeSummary: revision.changeSummary, createdAt: revision.createdAt },
    }, ...profiles];
  }

  async function create(companyId: string, input: CreateAgentRoleProfile, actor: BoardActor) {
    await ensureSeededProfiles(companyId);
    validateManagedFiles(input.managedFiles);
    try {
      return await db.transaction(async (tx) => {
        const [namedProfile] = await tx.select({ id: agentRoleProfiles.id }).from(agentRoleProfiles).where(and(
          eq(agentRoleProfiles.companyId, companyId),
          eq(agentRoleProfiles.name, input.name),
        ));
        if (namedProfile) throw conflict("A Role Profile with this name already exists");
        const [profile] = await tx.insert(agentRoleProfiles).values({
          companyId, key: `custom-${randomUUID()}`, name: input.name, description: input.description ?? null,
          kind: "custom", createdByUserId: actor.userId ?? null,
        }).returning();
        const [revision] = await tx.insert(agentRoleProfileRevisions).values({
          companyId, profileId: profile!.id, revisionNumber: 1, managedFiles: input.managedFiles,
          changeSummary: input.changeSummary ?? null, createdByUserId: actor.userId ?? null,
        }).returning();
        await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId ?? "board", action: "agent_role_profile.created", entityType: "agent_role_profile", entityId: profile!.id });
        return { ...profile!, readOnly: false, revision: publicRevision(revision!) };
      });
    } catch (error) {
      if (isUniqueViolation(error, "agent_role_profiles_company_name_uq")) {
        throw conflict("A Role Profile with this name already exists");
      }
      throw error;
    }
  }

  async function update(companyId: string, profileId: string, input: UpdateAgentRoleProfile, actor: BoardActor) {
    if (profileId === SYSTEM_CEO_PROFILE_ID) throw forbidden("The CEO Role Profile is read-only");
    assertProfileId(profileId);
    validateManagedFiles(input.managedFiles);
    return db.transaction(async (tx) => {
      const [existing] = await tx.select().from(agentRoleProfiles).where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, profileId), isNull(agentRoleProfiles.archivedAt))).for("update");
      if (!existing) throw notFound("Role Profile not found");
      const [current] = await tx.select({ number: max(agentRoleProfileRevisions.revisionNumber) }).from(agentRoleProfileRevisions)
        .where(and(eq(agentRoleProfileRevisions.companyId, companyId), eq(agentRoleProfileRevisions.profileId, profileId)));
      const [profile] = await tx.update(agentRoleProfiles).set({ name: input.name, description: input.description ?? null, updatedAt: new Date() })
        .where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, profileId))).returning();
      const [revision] = await tx.insert(agentRoleProfileRevisions).values({ companyId, profileId, revisionNumber: (current?.number ?? 0) + 1,
        managedFiles: input.managedFiles, changeSummary: input.changeSummary ?? null, createdByUserId: actor.userId ?? null }).returning();
      await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId ?? "board", action: "agent_role_profile.updated", entityType: "agent_role_profile", entityId: profileId });
      return { ...profile!, readOnly: false, revision: publicRevision(revision!) };
    });
  }

  async function listRevisions(companyId: string, profileId: string) {
    if (profileId === SYSTEM_CEO_PROFILE_ID) return [await ceoRevision(companyId)];
    assertProfileId(profileId);
    const [profile] = await db.select({ id: agentRoleProfiles.id }).from(agentRoleProfiles)
      .where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, profileId)));
    if (!profile) throw notFound("Role Profile not found");
    const revisions = await db.select().from(agentRoleProfileRevisions)
      .where(and(eq(agentRoleProfileRevisions.companyId, companyId), eq(agentRoleProfileRevisions.profileId, profileId)))
      .orderBy(desc(agentRoleProfileRevisions.revisionNumber));
    return revisions.map((revision) => ({ ...revision, number: revision.revisionNumber }));
  }

  async function getRevision(companyId: string, profileId: string, revisionId: string) {
    if (profileId === SYSTEM_CEO_PROFILE_ID) {
      if (revisionId === SYSTEM_CEO_PROFILE_ID) return ceoRevision(companyId);
      throw notFound("Role Profile revision not found");
    }
    assertProfileId(profileId);
    assertRevisionId(revisionId);
    const [revision] = await db.select().from(agentRoleProfileRevisions).where(and(
      eq(agentRoleProfileRevisions.companyId, companyId),
      eq(agentRoleProfileRevisions.profileId, profileId),
      eq(agentRoleProfileRevisions.id, revisionId),
    ));
    if (!revision) throw notFound("Role Profile revision not found");
    return { ...revision, number: revision.revisionNumber };
  }

  async function resolveAdoptionRevision(companyId: string, profileId: string, revisionId?: string, options?: { includeArchived?: boolean }) {
    if (profileId === SYSTEM_CEO_PROFILE_ID) throw forbidden("The CEO Role Profile cannot be applied to an agent");
    assertProfileId(profileId);
    const [profile] = await db.select().from(agentRoleProfiles).where(and(
      eq(agentRoleProfiles.companyId, companyId),
      eq(agentRoleProfiles.id, profileId),
      ...(options?.includeArchived ? [] : [isNull(agentRoleProfiles.archivedAt)]),
    ));
    if (!profile) throw notFound("Role Profile not found");
    const revision = revisionId
      ? await getRevision(companyId, profileId, revisionId)
      : await latestRevision(companyId, profileId);
    return { profile, revision };
  }

  async function getAdoption(companyId: string, agentId: string) {
    const [adoption] = await db.select().from(agentRoleProfileAdoptions).where(and(
      eq(agentRoleProfileAdoptions.companyId, companyId),
      eq(agentRoleProfileAdoptions.agentId, agentId),
    ));
    if (!adoption) return null;
    const [profile] = await db.select().from(agentRoleProfiles).where(and(
      eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, adoption.profileId),
    ));
    const [revision] = await db.select().from(agentRoleProfileRevisions).where(and(
      eq(agentRoleProfileRevisions.companyId, companyId), eq(agentRoleProfileRevisions.id, adoption.appliedRevisionId),
    ));
    if (!profile || !revision) throw notFound("Role Profile adoption not found");
    return { ...adoption, profile: { id: profile.id, name: profile.name, key: profile.key }, revision: publicRevision(revision) };
  }

  async function recordAdoption(input: {
    companyId: string; agentId: string; profileId: string; revisionId: string; managedPaths: string[];
    actor: BoardActor; action: "agent_role_profile.applied" | "agent_role_profile.restored";
  }) {
    const managedPaths = [...new Set(input.managedPaths.map(instructionPath))].sort();
    await db.transaction(async (tx) => {
      await tx.insert(agentRoleProfileAdoptions).values({
        companyId: input.companyId, agentId: input.agentId, profileId: input.profileId,
        appliedRevisionId: input.revisionId, managedPaths,
      }).onConflictDoUpdate({
        target: [agentRoleProfileAdoptions.companyId, agentRoleProfileAdoptions.agentId],
        set: { profileId: input.profileId, appliedRevisionId: input.revisionId, managedPaths, updatedAt: new Date() },
      });
      await tx.insert(activityLog).values({
        companyId: input.companyId, actorType: "user", actorId: input.actor.userId ?? "board",
        action: input.action, entityType: "agent", entityId: input.agentId,
        details: { profileId: input.profileId, revisionId: input.revisionId, managedPaths },
      });
    });
  }

  async function archive(companyId: string, profileId: string, actor: BoardActor) {
    if (profileId === SYSTEM_CEO_PROFILE_ID) throw forbidden("The CEO Role Profile is read-only");
    assertProfileId(profileId);
    return db.transaction(async (tx) => {
      const [profile] = await tx.update(agentRoleProfiles).set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(agentRoleProfiles.companyId, companyId), eq(agentRoleProfiles.id, profileId), isNull(agentRoleProfiles.archivedAt)))
        .returning();
      if (!profile) throw notFound("Role Profile not found");
      await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId ?? "board", action: "agent_role_profile.archived", entityType: "agent_role_profile", entityId: profileId });
      return { ...profile, readOnly: false };
    });
  }

  return { ensureSeededProfiles, list, create, update, archive, listRevisions, getRevision, latestRevision, resolveAdoptionRevision, getAdoption, recordAdoption };
}
