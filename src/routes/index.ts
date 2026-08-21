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
// that module is inactive in the DB. `auth` (not a manageable module) and `/modules` (the
// management API — must stay reachable to re-enable others) are always mounted.
const defaultRoutes = [
  { path: "/auth", route: authRoute },
  { path: "/notifications", route: notificationRoute, guard: "notification" },
  { path: "/cron-logs", route: cronRoute, guard: "cron" },
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
