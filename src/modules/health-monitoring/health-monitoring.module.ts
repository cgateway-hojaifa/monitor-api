/**
 * Health Monitoring module manifest.
 *
 * HTTP/API up-down monitoring. Owns its per-monitor runner and its scheduled tick. The in-process
 * scheduler calls `checkAllMonitors` on its interval (HEALTH_MONITORING_INTERVAL_SEC) — the cron
 * layer only makes this module-level call; all "what runs" logic lives in the module.
 * Notifications go through `@/shared/notify`. Schema is owned by TypeORM (synchronize), so no
 * per-module model sync.
 */
import type { ModuleManifest } from "@/shared/registry";
import { checkAllMonitors } from "@/modules/health-monitoring/services/runner";

// Cron interval configured via .env (HEALTH_MONITORING_INTERVAL_SEC, in seconds). If it is unset
// or not a positive number, the health-monitoring cron is disabled — no task is registered, so it
// never runs.
const INTERVAL_SEC = Number(process.env.HEALTH_MONITORING_INTERVAL_SEC);
const enabled = INTERVAL_SEC > 0;

export const healthMonitoringModule: ModuleManifest = {
  key: "health-monitoring",
  emitsNotifications: true, // checkMonitor notifies when a monitor goes down
  scheduledTasks: enabled
    ? [
        {
          module: "health-monitoring",
          intervalSec: INTERVAL_SEC,
          run: async () => {
            await checkAllMonitors();
          },
        },
      ]
    : [],
};
