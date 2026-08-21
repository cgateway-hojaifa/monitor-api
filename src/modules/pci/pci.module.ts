/**
 * PCI module manifest.
 *
 * Owns the Script Discovery & Inventory feature: projects, files, check history, emails,
 * validation checks, cron batch, and reports. Sends notifications via `@/shared/notify`.
 * Schema is owned by TypeORM (synchronize), so no per-module model sync.
 */
import type { ModuleManifest } from "@/shared/registry";
import { runAllFileChecks } from "@/modules/pci/services/checkRunner";

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
            await runAllFileChecks();
          },
        },
      ]
    : [],
};
