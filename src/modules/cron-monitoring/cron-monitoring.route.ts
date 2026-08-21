import { Router } from "express";
import * as controller from "@/modules/cron-monitoring/cron-monitoring.controller";
import * as schema from "@/modules/cron-monitoring/cron-monitoring.validation";
import validate from "@/middleware/validate";

/**
 * Session-guarded management routes for Cron Monitoring. Mounted under the `/api` auth gate.
 *
 * The PUSH ingest endpoint is NOT here — it is keyed by X-Cron-Key, not a session cookie, so it
 * mounts separately at the app root, outside the gate (see app.ts + cron-ingest.route.ts).
 */
const router = Router();

// Collection
router.get("/", validate(schema.listMonitors), controller.listMonitors);
router.post("/", validate(schema.createMonitor), controller.createMonitor);

// Item + nested actions
router.get("/:id", validate(schema.getMonitor), controller.getMonitor);
router.put("/:id", validate(schema.updateMonitor), controller.updateMonitor);
router.delete("/:id", validate(schema.deleteMonitor), controller.deleteMonitor);
router.post("/:id/regenerate-key", validate(schema.regenerateKey), controller.regenerateKey);
router.get("/:id/runs", validate(schema.runs), controller.runs);
router.get("/:id/daily-results", validate(schema.dailyResults), controller.dailyResults);

export default router;
