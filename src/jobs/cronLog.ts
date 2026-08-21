import { AppDataSource } from "@/config/data-source";
import { CronLog } from "@/entities/CronLog";
import type { CronTrigger } from "@/shared/cron";

/**
 * Cron logger — records each scheduled/manual run. Registered into the `@/shared/cron` IoC slot
 * at startup (by the cron module manifest). Lives in the top-level `jobs/` folder (dedicated
 * cron-job home) since it's cross-cutting: every module's scheduled task is wrapped by it.
 *
 * Runs a task while recording a cron-log row (module, start, finish, outcome). The task's own
 * result is returned untouched; logging failures never mask it.
 */

const repo = () => AppDataSource.getRepository(CronLog);

export async function logCronRun<T>(
  module: string,
  trigger: CronTrigger,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  let log: CronLog | null = null;
  try {
    log = await repo().save(
      repo().create({ module, trigger, status: "running", started_at: startedAt }),
    );
  } catch (err) {
    console.error(`[Cron] Failed to create log row for '${module}':`, (err as Error)?.message);
  }

  console.log(`[Cron] START module='${module}' trigger='${trigger}' at ${startedAt.toISOString()}`);

  try {
    const result = await task();
    const finishedAt = new Date();
    const duration = finishedAt.getTime() - startedAt.getTime();
    console.log(`[Cron] DONE  module='${module}' at ${finishedAt.toISOString()} (${duration}ms)`);
    if (log) {
      log.status = "success";
      log.finished_at = finishedAt;
      log.duration_ms = duration;
      await repo()
        .save(log)
        .catch(() => {});
    }
    return result;
  } catch (err) {
    const finishedAt = new Date();
    const duration = finishedAt.getTime() - startedAt.getTime();
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[Cron] ERROR module='${module}' at ${finishedAt.toISOString()} (${duration}ms):`,
      message,
    );
    if (log) {
      log.status = "error";
      log.finished_at = finishedAt;
      log.duration_ms = duration;
      log.message = message.slice(0, 500);
      await repo()
        .save(log)
        .catch(() => {});
    }
    throw err;
  }
}
