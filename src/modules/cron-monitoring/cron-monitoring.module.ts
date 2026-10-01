/**
 * Cron Monitoring module manifest (PUSH model).
 *
 * Remote jobs report each completed run to the ingest endpoint. Once a day this module's scheduled
 * task runs `runDailyCheck` — counting the day's runs per monitor and notifying on an under-run.
 *
 * The daily task uses the scheduler's `dailyAtMinute` cadence (minutes since local midnight), set
 * by CRON_MONITORING_AT ("HH:MM" 24h, or a raw minute-of-day 0–1439). If it is unset or invalid,
 * the daily check is disabled — no task is registered, so it never runs (ingest still accepts runs).
 *
 * Notifications go through `@/shared/notify`. Schema is owned by TypeORM (synchronize).
 */
import type { ModuleManifest } from "@/shared/registry";
import { runDailyCheck } from "@/modules/cron-monitoring/services/runDailyCheck";
import logger from "@/config/logger";

/** Parse "HH:MM" or a raw minute-of-day into 0–1439; null when unset or invalid. */
function resolveDailyMinute(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  }
  const rawMin = Number(value);
  return Number.isInteger(rawMin) && rawMin >= 0 && rawMin <= 1439 ? rawMin : null;
}

const dailyAtMinute = resolveDailyMinute(process.env.CRON_MONITORING_AT);

// A value that is set but unparseable disables the check too — say so, rather than silently.
if (dailyAtMinute === null && process.env.CRON_MONITORING_AT?.trim())
  logger.warn(
    `[cron-monitoring] Invalid CRON_MONITORING_AT "${process.env.CRON_MONITORING_AT}" — daily check disabled.`,
  );

export const cronMonitoringModule: ModuleManifest = {
  key: "cron-monitoring",
  emitsNotifications: true, // runDailyCheck notifies on an under-run
  scheduledTasks:
    dailyAtMinute !== null
      ? [
          {
            module: "cron-monitoring",
            dailyAtMinute,
            run: async () => {
              await runDailyCheck();
            },
          },
        ]
      : [],
};
