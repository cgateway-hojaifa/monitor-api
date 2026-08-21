import { AppDataSource } from "@/config/data-source";
import { CronMonitor } from "@/entities/CronMonitor";
import { CronRun } from "@/entities/CronRun";
import { CronDailyResult } from "@/entities/CronDailyResult";
import { notifyModule } from "@/shared/notify";
import { renderCronUnderran } from "@/modules/cron-monitoring/services/notifyTemplate";
import { dayBounds, dayKey } from "@/modules/cron-monitoring/services/dayWindow";
import logger from "@/config/logger";

/**
 * The daily check. For each active monitor: count the `cron_run` rows received during the target
 * calendar day, compare to `expected_per_day`, upsert a `cron_daily_result` row, and — when the
 * job under-ran (`actual < expected`) and no alert has gone out for that row yet — notify.
 *
 * Idempotent per (monitor, day): the unique (monitor_id, day) row is updated in place, and
 * `notified` guards against a second alert if the check runs twice the same day. Runs are counted
 * by `received_at` (our server clock), matching `dayWindow`.
 */

const monitorRepo = () => AppDataSource.getRepository(CronMonitor);
const runRepo = () => AppDataSource.getRepository(CronRun);
const resultRepo = () => AppDataSource.getRepository(CronDailyResult);

/**
 * Count of completed runs for a monitor during the local day containing `when`.
 *
 * One row = one completed run, bucketed by the day it was received (`received_at`).
 */
export async function countRunsForDay(monitorId: number, when: Date): Promise<number> {
  const { start, end } = dayBounds(when);
  const dayEnd = new Date(end.getTime() - 1);

  const row = await runRepo()
    .createQueryBuilder("r")
    .where("r.monitor_id = :monitorId", { monitorId })
    .andWhere("r.received_at BETWEEN :start AND :dayEnd", { start, dayEnd })
    .select("COUNT(*)", "cnt")
    .getRawOne<{ cnt: string }>();

  return Number(row?.cnt ?? 0);
}

export interface DailyCheckOutcome {
  monitor_id: number;
  monitor_name: string;
  day: string;
  expected: number;
  actual: number;
  passed: boolean;
  notified: boolean;
}

/** Evaluate one monitor for the day containing `when` (defaults to now). */
export async function checkMonitorForDay(
  monitor: CronMonitor,
  when: Date = new Date(),
): Promise<DailyCheckOutcome> {
  const day = dayKey(when);
  const expected = monitor.expected_per_day;
  const actual = await countRunsForDay(monitor.id, when);
  const passed = actual >= expected;

  // Upsert the (monitor, day) audit row, preserving a prior `notified` flag.
  const existing = await resultRepo().findOne({
    where: { monitor_id: monitor.id, day },
  });
  const row =
    existing ??
    resultRepo().create({ monitor_id: monitor.id, day, notified: false });
  row.expected = expected;
  row.actual = actual;
  row.passed = passed;

  let notified = row.notified;
  if (!passed && !row.notified) {
    try {
      await notifyModule(
        "cron-monitoring",
        renderCronUnderran({
          monitor_id: monitor.id,
          monitor_name: monitor.name,
          expected,
          actual,
          day,
        }),
      );
      notified = true;
    } catch (err) {
      logger.error(`[cron-monitoring] notify failed for monitor ${monitor.id}: ${String(err)}`);
    }
  }
  row.notified = notified;

  await resultRepo().save(row);
  monitor.last_checked_at = new Date();
  await monitorRepo().save(monitor);

  return { monitor_id: monitor.id, monitor_name: monitor.name, day, expected, actual, passed, notified };
}

/** Run the daily check across every active monitor. Called by the scheduler at the daily time. */
export async function runDailyCheck(when: Date = new Date()): Promise<DailyCheckOutcome[]> {
  const monitors = await monitorRepo().find({ where: { active: true } });
  const results: DailyCheckOutcome[] = [];
  for (const monitor of monitors) {
    try {
      results.push(await checkMonitorForDay(monitor, when));
    } catch (err) {
      logger.error(`[cron-monitoring] daily check failed for monitor ${monitor.id}: ${String(err)}`);
    }
  }
  const failed = results.filter((r) => !r.passed).length;
  logger.info(
    `[cron-monitoring] daily check: ${results.length} monitor(s), ${failed} under-ran.`,
  );
  return results;
}
