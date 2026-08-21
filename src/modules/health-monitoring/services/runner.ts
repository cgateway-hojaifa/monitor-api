import { AppDataSource } from "@/config/data-source";
import { HealthMonitor } from "@/entities/HealthMonitor";
import { checkMonitor, type CheckResult } from "@/modules/health-monitoring/services/checkMonitor";

/**
 * Module-level scheduler entrypoint. The in-process scheduler calls this on its interval (set by
 * HEALTH_MONITORING_INTERVAL_SEC in .env, default 60s). Every active monitor is checked on
 * each tick — there is no per-monitor interval. The cron layer stays a plain function call;
 * all "what runs" logic lives here, inside the module.
 */
export async function checkAllMonitors(): Promise<CheckResult[]> {
  const monitors = await AppDataSource.getRepository(HealthMonitor).find({
    where: { active: true },
  });
  const settled = await Promise.allSettled(monitors.map((m) => checkMonitor(m)));
  return settled
    .filter((r): r is PromiseFulfilledResult<CheckResult> => r.status === "fulfilled")
    .map((r) => r.value);
}

// Re-export so consumers import a single runner surface.
export { checkMonitor };
