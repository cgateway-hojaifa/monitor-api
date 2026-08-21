import { Router } from "express";
import * as ipMonitoringController from "@/modules/ip-monitoring/ip-monitoring.controller";
import * as schema from "@/modules/ip-monitoring/ip-monitoring.validation";
import validate from "@/middleware/validate";

const router = Router();

// Order matters: fixed sub-paths before "/:id".
router.post("/check-all", validate(schema.checkAll), ipMonitoringController.checkAll);

// Collection
router.get("/", validate(schema.listMonitors), ipMonitoringController.listMonitors);
router.post("/", validate(schema.createMonitor), ipMonitoringController.createMonitor);

// Item + nested actions
router.get("/:id", validate(schema.getMonitor), ipMonitoringController.getMonitor);
router.put("/:id", validate(schema.updateMonitor), ipMonitoringController.updateMonitor);
router.delete("/:id", validate(schema.deleteMonitor), ipMonitoringController.deleteMonitor);
router.post("/:id/check", validate(schema.checkOne), ipMonitoringController.checkOne);
router.get("/:id/heartbeats", validate(schema.heartbeats), ipMonitoringController.heartbeats);
router.delete(
  "/:id/heartbeats",
  validate(schema.clearHeartbeats),
  ipMonitoringController.clearHeartbeats,
);

export default router;
