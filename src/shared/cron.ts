/**
 * Cron logging facade (inversion of control).
 *
 * The scheduler and any module that runs a manual task call `runWithLog(...)` to get a
 * persisted cron-log row. The implementation lives in the Central module and is injected at
 * startup via `registerCronLogger(...)`. Mirrors the notification IoC in `@/shared/notify`.
 */
export type CronTrigger = "schedule" | "manual";

export type CronLogger = <T>(
  module: string,
  trigger: CronTrigger,
  task: () => Promise<T>,
) => Promise<T>;

let logger: CronLogger | null = null;

export function registerCronLogger(fn: CronLogger): void {
  logger = fn;
}

export async function runWithLog<T>(
  module: string,
  trigger: CronTrigger,
  task: () => Promise<T>,
): Promise<T> {
  if (!logger) {
    console.warn(`[Cron] No logger registered — running '${module}' unlogged.`);
    return task();
  }
  return logger(module, trigger, task);
}
