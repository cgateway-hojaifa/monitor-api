import express from "express";

import authRoute from "@/modules/auth/auth.route";
import notificationRoute from "@/modules/notification/notification.route";
import cronRoute from "@/modules/cron/cron.route";
import pciRoute from "@/modules/pci/pci.route";
import healthMonitoringRoute from "@/modules/health-monitoring/health-monitoring.route";
import ipMonitoringRoute from "@/modules/ip-monitoring/ip-monitoring.route";
import cronMonitoringRoute from "@/modules/cron-monitoring/cron-monitoring.route";
import categoryRoute from "@/modules/category/category.route";
import moduleRoute from "@/modules/module/module.route";
import { moduleGuard } from "@/middleware/moduleGuard";

const router = express.Router();

// Declare each mount path + router. Feature modules carry a `guard` slug: their routes 404 when
// that module is inactive in the DB. Always mounted (no guard): `auth` (not a manageable module),
// `/modules` (the management API — must stay reachable to re-enable others), and the infra
// modules `notification` / `cron` — infra manifests have no `modules` row by design (see
// shared/registry.ts), so a guard on their slug could never pass. Their pages are shown/hidden
// through the nav rows (`settings-notifications`, `settings-cron-logs`) instead.
const defaultRoutes = [
  { path: "/auth", route: authRoute },
  { path: "/notifications", route: notificationRoute },
  { path: "/cron-logs", route: cronRoute },
  { path: "/pci", route: pciRoute, guard: "pci" },
  { path: "/health-monitoring", route: healthMonitoringRoute, guard: "health-monitoring" },
  { path: "/ip-monitoring", route: ipMonitoringRoute, guard: "ip-monitoring" },
  { path: "/cron-monitoring", route: cronMonitoringRoute, guard: "cron-monitoring" },
  { path: "/categories", route: categoryRoute, guard: "category" },
  { path: "/modules", route: moduleRoute },
];

defaultRoutes.forEach((route) => {
  if (route.guard) router.use(route.path, moduleGuard(route.guard), route.route);
  else router.use(route.path, route.route);
});

export default router;
