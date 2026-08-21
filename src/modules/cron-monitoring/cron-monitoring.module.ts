/**
 * Cron Monitoring module manifest (PUSH model).
 *
 * Remote jobs report each completed run to the ingest endpoint. Once a day this module's scheduled
 * task runs `runDailyCheck` — counting the day's runs per monitor and notifying on an under-run.
 *
 * The daily task uses the scheduler's `dailyAtMinute` cadence (minutes since local midnight). The
 * time is configurable via CRON_MONITORING_AT ("HH:MM" 24h, or a raw minute-of-day 0–1439);
 * default 1439 (23:59). Setting CRON_MONITORING_ENABLED=false registers no task, disabling the
 * daily check (ingest still accepts runs, and a manual "Check all" still works from the UI).
 *
 * Notifications go through `@/shared/notify`. Schema is owned by TypeORM (synchronize).
 */
import type { ModuleManifest } from "@/shared/registry";
import { runDailyCheck } from "@/modules/cron-monitoring/services/runDailyCheck";

const DEFAULT_MINUTE = 1439; // 23:59

/** Parse "HH:MM" or a raw minute-of-day into 0–1439; fall back to 23:59 on anything invalid. */
function resolveDailyMinute(raw: string | undefined): number {
  if (!raw) return DEFAULT_MINUTE;
  const value = raw.trim();
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
    return DEFAULT_MINUTE;
  }
  const rawMin = Number(value);
  return Number.isInteger(rawMin) && rawMin >= 0 && rawMin <= 1439 ? rawMin : DEFAULT_MINUTE;
}

const enabled = process.env.CRON_MONITORING_ENABLED !== "false";
const dailyAtMinute = resolveDailyMinute(process.env.CRON_MONITORING_AT);

export const cronMonitoringModule: ModuleManifest = {
  key: "cron-monitoring",
  emitsNotifications: true, // runDailyCheck notifies on an under-run
  scheduledTasks: enabled
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
