/**
 * IP Monitoring module manifest.
 *
 * TCP reachability monitoring for `ip_address:port` targets.
 *
 * NOTE — no `scheduledTasks` on purpose. This module is manual-check only: the in-process
 * scheduler must never run these probes, so the manifest registers nothing for it to pick up.
 * Checks happen solely via `POST /api/ip-monitoring/:id/check` and `/check-all`, both of which
 * require a session. Adding a scheduled task here would silently violate that requirement.
 *
 * Notifications go through `@/shared/notify` (down alerts still fire, but only as the result of a
 * user-triggered check). Schema is owned by TypeORM (synchronize), so no per-module model sync.
 */
import type { ModuleManifest } from "@/shared/registry";

export const ipMonitoringModule: ModuleManifest = {
  key: "ip-monitoring",
  emitsNotifications: true, // checkIpMonitor notifies when a target goes down
  scheduledTasks: [],
};
