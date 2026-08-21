import { Router } from "express";
import * as pciController from "@/modules/pci/pci.controller";
import * as schema from "@/modules/pci/pci.validation";
import validate from "@/middleware/validate";

const router = Router();

// Order matters: fixed sub-paths (/projects/report, /files/check) before "/:id".

// ── Projects ──
router.get("/projects/report", validate(schema.reportProjects), pciController.reportProjects);
router.get("/projects", validate(schema.listProjects), pciController.listProjects);
router.post("/projects", validate(schema.createProject), pciController.createProject);
router.get("/projects/:id/report", validate(schema.reportProject), pciController.reportProject);
router.get("/projects/:id", validate(schema.getProject), pciController.getProject);
router.put("/projects/:id", validate(schema.updateProject), pciController.updateProject);
router.delete("/projects/:id", validate(schema.deleteProject), pciController.deleteProject);

// ── Files ──
router.post("/files/check", validate(schema.checkFile), pciController.checkFile);
router.get("/files", validate(schema.listFiles), pciController.listFiles);
router.post("/files", validate(schema.createFile), pciController.createFile);
router.get("/files/:id", validate(schema.getFile), pciController.getFile);
router.put("/files/:id", validate(schema.updateFile), pciController.updateFile);
router.delete("/files/:id", validate(schema.deleteFile), pciController.deleteFile);

// ── Emails ──
router.get("/emails", validate(schema.listEmails), pciController.listEmails);
router.post("/emails", validate(schema.createEmail), pciController.createEmail);
router.get("/emails/:id", validate(schema.getEmail), pciController.getEmail);
router.put("/emails/:id", validate(schema.updateEmail), pciController.updateEmail);
router.delete("/emails/:id", validate(schema.deleteEmail), pciController.deleteEmail);

// ── Check history ──
router.get("/check-history", validate(schema.listCheckHistory), pciController.listCheckHistory);

// ── Health (DB connectivity) ──
router.get("/health", pciController.health);

// ── Manual run from the dashboard (session-authenticated via authGate) ──
router.post("/run", pciController.runManual);

export default router;
