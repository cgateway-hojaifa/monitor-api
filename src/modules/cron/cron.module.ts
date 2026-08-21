/**
 * Cron module manifest.
 *
 * Owns the cron-log read model, and wires the cron run-logger (`@/jobs/cronLog`) into the shared
 * IoC slot at startup so the scheduler can log every run without importing the logger directly.
 */
import type { ModuleManifest } from "@/shared/registry";
import { registerCronLogger } from "@/shared/cron";
import { logCronRun } from "@/jobs/cronLog";

export const cronModule: ModuleManifest = {
  key: "cron",
  infra: true, // pure IoC wiring; no nav, no DB row — always inits
  init() {
    registerCronLogger(logCronRun);
  },
};
