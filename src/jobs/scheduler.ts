import { getScheduledTasks, type ScheduledTask } from "@/shared/registry";
import { runWithLog } from "@/shared/cron";
import logger from "@/config/logger";

/**
 * In-process cron scheduler. Lives in the top-level `jobs/` folder (dedicated cron-job home).
 *
 * Owns a single tick. Each module registers its tasks via its manifest (`scheduledTasks`);
 * the scheduler only decides *when* to run and logs *that* it ran (via `runWithLog`).
 *
 * Two cadences are supported per task (mutually exclusive):
 *   - `intervalSec`   — fire every N seconds from boot (next-due timestamp).
 *   - `dailyAtMinute` — fire once per day when the local clock reaches that minute-of-day.
 *
 * Per-task state: an in-flight guard so a slow task never overlaps itself, plus a next-due
 * timestamp (interval tasks) or a last-fired calendar day (daily tasks).
 */

const MIN_TICK_MS = 5_000;
const MAX_TICK_MS = 30_000;
// Daily tasks are minute-granular, so a tick no coarser than this keeps them punctual even when
// every registered task is a daily one (which would otherwise leave `minIntervalMs` undefined).
const DAILY_TICK_MS = 30_000;

interface TaskState {
  task: ScheduledTask;
  /** Interval tasks only: epoch-ms the task is next allowed to run. */
  nextDueMs: number;
  /** Daily tasks only: `YYYY-M-D` of the local day the task last fired on (empty = never). */
  lastFiredDay: string;
  running: boolean;
}

/** Local minutes since midnight for a Date (0–1439). */
function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** A stable per-local-day key, so a daily task fires at most once per calendar day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isDaily(t: ScheduledTask): boolean {
  return typeof t.dailyAtMinute === "number";
}

let started = false;

export async function startScheduler(): Promise<void> {
  if (started) return;
  started = true;

  const tasks = await getScheduledTasks();
  if (tasks.length === 0) {
    logger.info("[Scheduler] No scheduled tasks registered.");
    return;
  }

  const now = Date.now();
  const states: TaskState[] = tasks.map((task) => ({
    task,
    // Interval tasks: first run one interval from startup (avoids a thundering-herd run at boot).
    // Daily tasks ignore this field.
    nextDueMs: isDaily(task) ? 0 : now + (task.intervalSec ?? 0) * 1000,
    lastFiredDay: "",
    running: false,
  }));

  // Tick fast enough for the shortest interval task; if there are only daily tasks, fall back to a
  // minute-granular tick so they still fire near their target minute.
  const intervalMs = states
    .filter((s) => !isDaily(s.task))
    .map((s) => (s.task.intervalSec ?? 0) * 1000)
    .filter((ms) => ms > 0);
  const tickMs = intervalMs.length
    ? Math.max(MIN_TICK_MS, Math.min(MAX_TICK_MS, Math.floor(Math.min(...intervalMs) / 2)))
    : DAILY_TICK_MS;

  logger.info(
    `[Scheduler] Started with ${states.length} task(s) (tick ${tickMs / 1000}s): ` +
      states
        .map((s) =>
          isDaily(s.task)
            ? `${s.task.module}@daily:${s.task.dailyAtMinute}m`
            : `${s.task.module}@${s.task.intervalSec}s`,
        )
        .join(", "),
  );

  setInterval(() => {
    const t = Date.now();
    const nowDate = new Date(t);
    const nowMinute = minuteOfDay(nowDate);
    const today = dayKey(nowDate);

    for (const state of states) {
      if (state.running) continue;

      if (isDaily(state.task)) {
        // Fire once per calendar day, on the first tick at or after the target minute. A process
        // that boots after the target minute will fire on its first tick that day (catch-up); one
        // already running fires exactly once when the clock crosses the minute.
        const due = nowMinute >= (state.task.dailyAtMinute ?? 0) && state.lastFiredDay !== today;
        if (!due) continue;
        state.lastFiredDay = today;
      } else {
        if (t < state.nextDueMs) continue;
        state.nextDueMs = t + (state.task.intervalSec ?? 0) * 1000;
      }

      state.running = true;
      runWithLog(state.task.module, "schedule", state.task.run)
        .catch(() => {
          /* already logged in runWithLog */
        })
        .finally(() => {
          state.running = false;
        });
    }
  }, tickMs);
}
