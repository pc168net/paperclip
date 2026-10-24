import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb } from "@paperclipai/db";
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
    await request(app(first)).get(`/api/companies/${second}/agent-role-profiles`).expect(403);
  });
});
