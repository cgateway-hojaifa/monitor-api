import { Router } from "express";
import * as moduleController from "@/modules/module/module.controller";
import * as schema from "@/modules/module/module.validation";
import validate from "@/middleware/validate";

const router = Router();

// Mounted at /api/modules. Fixed sub-paths (/nav, /scopes) before "/:id".
router.get("/nav", validate(schema.getNav), moduleController.getNav);
router.get("/scopes", validate(schema.getModuleScopes), moduleController.getModuleScopes);
router.get("/schedules", validate(schema.getModuleSchedules), moduleController.getModuleSchedules);

router.get("/", validate(schema.listModules), moduleController.listModules);
router.post("/", validate(schema.createModule), moduleController.createModule);
router.get("/:id", validate(schema.getModule), moduleController.getModule);
router.put("/:id", validate(schema.updateModule), moduleController.updateModule);
router.delete("/:id", validate(schema.deleteModule), moduleController.deleteModule);

export default router;
