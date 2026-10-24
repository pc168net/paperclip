import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agentRoleProfileRevisions, agentRoleProfiles, companies, createDb } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { errorHandler } from "../middleware/index.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentRoleProfileRoutes } from "../routes/agent-role-profiles.js";

const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) console.warn(`Role Profile database tests unavailable: ${support.reason}`);

(support.supported ? describe : describe.skip)("agent role profiles", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("paperclip-role-profiles-");
    db = createDb(temp.connectionString);
  }, 30_000);
  afterAll(async () => { await temp?.cleanup(); });

  async function company() {
    const id = randomUUID();
    await db.insert(companies).values({ id, name: "Profile test", issuePrefix: `RP${id.slice(0, 6)}` });
    return id;
  }
  function app(companyId: string) {
    const result = express();
    result.use(express.json());
    result.use((req, _res, next) => {
      req.actor = { type: "board", source: "session", userId: "board", companyIds: [companyId], memberships: [{ companyId, membershipRole: "admin", status: "active" }] };
      next();
    });
    result.use("/api", agentRoleProfileRoutes(db));
    result.use(errorHandler);
    return result;
  }

  it("seeds a read-only CEO entry and keeps profiles company-scoped", async () => {
    const first = await company();
    const second = await company();
    const profiles = await request(app(first)).get(`/api/companies/${first}/agent-role-profiles`).expect(200);
    expect(profiles.body.find((profile: { kind: string }) => profile.kind === "system_ceo")).toMatchObject({ name: "CEO", readOnly: true });
    expect(profiles.body.some((profile: { name: string; readOnly: boolean }) => profile.name === "Engineer" && !profile.readOnly)).toBe(true);
    await request(app(first)).get(`/api/companies/${first}/agent-role-profiles`).expect(200);
    const seeded = await db.select().from(agentRoleProfiles).where(eq(agentRoleProfiles.companyId, first));
    expect(seeded).toHaveLength(11);
    await request(app(first)).get(`/api/companies/${second}/agent-role-profiles`).expect(403);
  });

  it("seeds reserved role profiles before rejecting a custom name collision", async () => {
    const companyId = await company();
    const api = app(companyId);

    await request(api)
      .post(`/api/companies/${companyId}/agent-role-profiles`)
      .send({ name: "Engineer", managedFiles: { "AGENTS.md": "Custom engineer" } })
      .expect(409);

    const profiles = await request(api).get(`/api/companies/${companyId}/agent-role-profiles`).expect(200);
    expect(profiles.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "engineer", name: "Engineer", kind: "seeded", readOnly: false }),
    ]));
  });

  it.each(["C:/instructions.md", "notes\0instructions.md"])("rejects manifests with an instruction path rejected by the file policy: %s", async (path) => {
    const companyId = await company();
    await request(app(companyId))
      .post(`/api/companies/${companyId}/agent-role-profiles`)
      .send({ name: `Invalid ${path}`, managedFiles: { [path]: "Unsafe" } })
      .expect(422);
  });

  it("returns 400 rather than a database error for malformed revision profile ids", async () => {
    const companyId = await company();
    const api = app(companyId);
    await request(api).get(`/api/companies/${companyId}/agent-role-profiles/not-a-uuid/revisions`).expect(400);
    await request(api).get(`/api/companies/${companyId}/agent-role-profiles/not-a-uuid/revisions/not-a-uuid`).expect(400);
  });

  it("keeps revisions immutable, archives non-CEO profiles, and rejects CEO mutations", async () => {
    const companyId = await company();
    const api = app(companyId);
    const created = await request(api)
      .post(`/api/companies/${companyId}/agent-role-profiles`)
      .send({ name: "Release manager", description: "Initial", managedFiles: { "AGENTS.md": "first" } })
      .expect(201);
    const profileId = created.body.id as string;
    const firstRevisionId = created.body.revision.id as string;

    await request(api)
      .put(`/api/companies/${companyId}/agent-role-profiles/${profileId}`)
      .send({ name: "Release manager", description: "Revised", managedFiles: { "AGENTS.md": "second" } })
      .expect(200);

    const revisions = await request(api)
      .get(`/api/companies/${companyId}/agent-role-profiles/${profileId}/revisions`)
      .expect(200);
    expect(revisions.body.map((revision: { id: string; managedFiles: Record<string, string> }) => revision.id)).toContain(firstRevisionId);
    expect(revisions.body.map((revision: { managedFiles: Record<string, string> }) => revision.managedFiles["AGENTS.md"])).toEqual(["second", "first"]);

    const storedRevisions = await db.select().from(agentRoleProfileRevisions).where(and(
      eq(agentRoleProfileRevisions.companyId, companyId),
      eq(agentRoleProfileRevisions.profileId, profileId),
    ));
    expect(storedRevisions).toHaveLength(2);
    await request(api)
      .get(`/api/companies/${companyId}/agent-role-profiles/${profileId}/revisions/${firstRevisionId}`)
      .expect(200)
      .expect(({ body }) => expect(body.managedFiles).toEqual({ "AGENTS.md": "first" }));

    const otherCompanyId = await company();
    await request(app(otherCompanyId))
      .get(`/api/companies/${otherCompanyId}/agent-role-profiles/${profileId}/revisions`)
      .expect(404);

    await request(api).post(`/api/companies/${companyId}/agent-role-profiles/${profileId}/archive`).expect(200);
    const listed = await request(api).get(`/api/companies/${companyId}/agent-role-profiles`).expect(200);
    expect(listed.body.map((profile: { id: string }) => profile.id)).not.toContain(profileId);
    await request(api)
      .put(`/api/companies/${companyId}/agent-role-profiles/system-ceo`)
      .send({ name: "CEO", managedFiles: { "AGENTS.md": "nope" } })
      .expect(403);
    await request(api).post(`/api/companies/${companyId}/agent-role-profiles/system-ceo/archive`).expect(403);

    const activities = await db.select().from(activityLog).where(eq(activityLog.companyId, companyId));
    expect(activities.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "agent_role_profile.created",
      "agent_role_profile.updated",
      "agent_role_profile.archived",
    ]));
  });
});
