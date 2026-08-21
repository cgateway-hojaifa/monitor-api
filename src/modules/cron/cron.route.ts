import express from "express";
import * as cronController from "@/modules/cron/cron.controller";
import * as schema from "@/modules/cron/cron.validation";
import validate from "@/middleware/validate";

const router = express.Router();

// Mounted at /api/cron-logs. Fixed sub-path (/modules) has no "/:id" to collide with, but keep
// it above the list route for consistency with the other modules.
router.get("/modules", validate(schema.listCronLogModules), cronController.listCronLogModules);
router.get("/", validate(schema.listCronLogs), cronController.listCronLogs);

export default router;
