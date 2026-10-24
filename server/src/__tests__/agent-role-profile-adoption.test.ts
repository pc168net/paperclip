import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { agentFileStore, fileHash } from "../services/agent-file-store.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoleProfileRoutes } from "../routes/agent-role-profiles.js";
import { agentRoutes } from "../routes/agents.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) console.warn(`Role Profile adoption database tests unavailable: ${support.reason}`);

(support.supported ? describe : describe.skip)("agent role profile adoption", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("paperclip-role-profile-adoption-");
    db = createDb(temp.connectionString);
  }, 30_000);
  afterAll(async () => { await temp?.cleanup(); });

  async function createCompany() {
    const id = randomUUID();
    await db.insert(companies).values({ id, name: "Adoption test", issuePrefix: `RA${id.slice(0, 6)}` });
    return id;
  }

  function app(companyId: string) {
    const result = express();
    result.use(express.json());
    result.use((req, _res, next) => {
      req.actor = {
        type: "board", source: "local_implicit", userId: "board", companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "admin", status: "active" }], isInstanceAdmin: true,
      };
      next();
    });
    result.use("/api", agentRoleProfileRoutes(db));
    result.use("/api", agentRoutes(db));
    result.use(errorHandler);
    return result;
  }

  it("copies a selected Profile's files into independent general agents after explicit duplicate confirmation", async () => {
    const companyId = await createCompany();
    const api = app(companyId);
    const profile = await request(api)
      .post(`/api/companies/${companyId}/agent-role-profiles`)
      .send({ name: "Research", managedFiles: { "AGENTS.md": "Research instructions", "SOUL.md": "Curious" } })
      .expect(201);

    const first = await request(api)
      .post(`/api/companies/${companyId}/agents`)
      .send({ name: "Research one", adapterType: "claude_local", roleProfileId: profile.body.id })
      .expect(201);
    expect(first.body.role).toBe("general");
    await request(api)
      .get(`/api/agents/${first.body.id}/instructions-bundle/file?path=AGENTS.md`)
      .expect(200)
      .expect(({ body }) => expect(body.content).toBe("Research instructions"));
    await request(api)
      .get(`/api/agents/${first.body.id}/instructions-bundle/file?path=SOUL.md`)
      .expect(200)
      .expect(({ body }) => expect(body.content).toBe("Curious"));

    const second = await request(api)
      .post(`/api/companies/${companyId}/agents`)
      .send({ name: "Research two", adapterType: "claude_local", roleProfileId: profile.body.id, allowDuplicate: true })
      .expect(201);
    expect(second.body.role).toBe("general");
  });

  it("restores only files recorded in the adoption manifest", async () => {
    const companyId = await createCompany();
    const api = app(companyId);
    const profile = await request(api)
      .post(`/api/companies/${companyId}/agent-role-profiles`)
      .send({ name: "Restore profile", managedFiles: { "AGENTS.md": "Profile agent", "SOUL.md": "Profile soul" } })
      .expect(201);
    const created = await request(api)
      .post(`/api/companies/${companyId}/agents`)
      .send({ name: "Restore agent", adapterType: "claude_local", roleProfileId: profile.body.id })
      .expect(201);
    const files = agentFileStore(db);
    const actor = { type: "board" as const, source: "local_implicit" as const, userId: "board", companyIds: [companyId], isInstanceAdmin: true };
    const soul = await files.read(companyId, created.body.id, "SOUL.md", actor);
    await files.write({ companyId, agentId: created.body.id, path: "SOUL.md", bytes: Buffer.from("Changed soul"), baseHash: fileHash(soul!) }, actor);
    await files.write({ companyId, agentId: created.body.id, path: "notes.md", bytes: Buffer.from("Independent notes"), baseHash: null }, actor);

    const diff = await request(api)
      .get(`/api/agents/${created.body.id}/role-profile/diff`)
      .expect(200);
    expect(diff.body.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "SOUL.md", status: "changed" }),
    ]));
    const restored = await request(api)
      .post(`/api/agents/${created.body.id}/role-profile/restore`)
      .send({ confirm: true });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);

    expect((await files.read(companyId, created.body.id, "SOUL.md", actor))?.toString("utf8")).toBe("Profile soul");
    expect((await files.read(companyId, created.body.id, "notes.md", actor))?.toString("utf8")).toBe("Independent notes");
  });
});
