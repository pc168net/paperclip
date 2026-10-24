import { Router } from "express";
import { companies, type Db } from "@paperclipai/db";
import { createAgentRoleProfileSchema, updateAgentRoleProfileSchema } from "@paperclipai/shared";
import { eq } from "drizzle-orm";
import { notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { agentRoleProfileService } from "../services/agent-role-profiles.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

export function agentRoleProfileRoutes(db: Db) {
  const router = Router();
  const service = agentRoleProfileService(db);
  router.use("/companies/:companyId/agent-role-profiles", async (req, _res, next) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!await db.query.companies.findFirst({ where: eq(companies.id, companyId) })) throw notFound("Company not found");
    next();
  });
  router.get("/companies/:companyId/agent-role-profiles", async (req, res) => {
    res.json(await service.list(req.params.companyId as string));
  });
  router.post("/companies/:companyId/agent-role-profiles", validate(createAgentRoleProfileSchema), async (req, res) => {
    res.status(201).json(await service.create(req.params.companyId as string, req.body, req.actor));
  });
  router.put("/companies/:companyId/agent-role-profiles/:profileId", validate(updateAgentRoleProfileSchema), async (req, res) => {
    res.json(await service.update(req.params.companyId as string, req.params.profileId as string, req.body, req.actor));
  });
  router.post("/companies/:companyId/agent-role-profiles/:profileId/archive", async (req, res) => {
    res.json(await service.archive(req.params.companyId as string, req.params.profileId as string, req.actor));
  });
  router.get("/companies/:companyId/agent-role-profiles/:profileId/revisions", async (req, res) => {
    res.json(await service.listRevisions(req.params.companyId as string, req.params.profileId as string));
  });
  router.get("/companies/:companyId/agent-role-profiles/:profileId/revisions/:revisionId", async (req, res) => {
    res.json(await service.getRevision(req.params.companyId as string, req.params.profileId as string, req.params.revisionId as string));
  });
  return router;
}
