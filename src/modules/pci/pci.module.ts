/**
 * PCI module manifest.
 *
 * Owns the Script Discovery & Inventory feature: projects, files, check history, emails,
 * validation checks, cron batch, and reports. Sends notifications via `@/shared/notify`.
 * Schema is owned by TypeORM (synchronize), so no per-module model sync.
 */
import type { ModuleManifest } from "@/shared/registry";
import { runScheduledBatch } from "@/modules/pci/services/batch";
import { AppDataSource } from "@/config/data-source";
import { CronLog } from "@/entities/CronLog";

/** Start time of the last finished PCI batch (scheduled or manual), from the cron log. */
async function lastPciRun(): Promise<Date | null> {
  const row = await AppDataSource.getRepository(CronLog)
    .createQueryBuilder("l")
    .select("MAX(l.started_at)", "last")
    .where("l.module = :m AND l.status <> :running", { m: "pci", running: "running" })
    .getRawOne<{ last: Date | null }>();
  return row?.last ? new Date(row.last) : null;
}

// Cron interval configured via .env (PCI_INTERVAL_SEC, in seconds). If it is unset or not a
// positive number, the PCI file-check cron is disabled — no task is registered, so it never runs.
const INTERVAL_SEC = Number(process.env.PCI_INTERVAL_SEC);
const enabled = INTERVAL_SEC > 0;

export const pciModule: ModuleManifest = {
  key: "pci",
  emitsNotifications: true, // checkRunner notifies on failed file checks
  scheduledTasks: enabled
    ? [
        {
          module: "pci",
          intervalSec: INTERVAL_SEC,
          run: async () => {
            await runScheduledBatch();
          },
          // Keep the 8-hourly rhythm across restarts instead of restarting the clock at each boot.
          lastRunAt: lastPciRun,
        },
      ]
    : [],
};
