import { Router } from "express";
import * as healthMonitoringController from "@/modules/health-monitoring/health-monitoring.controller";
import * as schema from "@/modules/health-monitoring/health-monitoring.validation";
import validate from "@/middleware/validate";

const router = Router();

// Order matters: fixed sub-paths (/status, /check-all) before "/:id".
router.get("/status", validate(schema.status), healthMonitoringController.status);
router.post("/check-all", validate(schema.checkAll), healthMonitoringController.checkAll);

// Collection
router.get("/", validate(schema.listMonitors), healthMonitoringController.listMonitors);
router.post("/", validate(schema.createMonitor), healthMonitoringController.createMonitor);

// Item + nested actions
router.get("/:id", validate(schema.getMonitor), healthMonitoringController.getMonitor);
router.put("/:id", validate(schema.updateMonitor), healthMonitoringController.updateMonitor);
router.delete("/:id", validate(schema.deleteMonitor), healthMonitoringController.deleteMonitor);
router.post("/:id/check", validate(schema.checkOne), healthMonitoringController.checkOne);
router.get("/:id/heartbeats", validate(schema.heartbeats), healthMonitoringController.heartbeats);
router.delete(
  "/:id/heartbeats",
  validate(schema.clearHeartbeats),
  healthMonitoringController.clearHeartbeats,
);
router.get("/:id/events", validate(schema.events), healthMonitoringController.events);

export default router;
