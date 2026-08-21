/**
 * Module behavior registry — composition root for module *code*.
 *
 * The DB `modules` table owns module *membership + metadata*; this file owns the *behavior* that
 * can't live in a row (IoC wiring, scheduled jobs). Each manifest's `key` is its module **slug**;
 * a manifest's behavior only runs when that slug's DB row is `status = active`. So disabling a
 * module from Settings → Module Management stops its cron/init on the next boot with no code change.
 *
 * Adding a module with new behavior = add its manifest here + a seeded/created DB row. Adding a
 * module that only reorders/renames/toggles/gates existing behavior = pure DB (no entry here).
 */
import { AppDataSource } from "@/config/data-source";
import { Module } from "@/entities/Module";
import { notificationModule } from "@/modules/notification/notification.module";
import { cronModule } from "@/modules/cron/cron.module";
import { pciModule } from "@/modules/pci/pci.module";
import { healthMonitoringModule } from "@/modules/health-monitoring/health-monitoring.module";
import { ipMonitoringModule } from "@/modules/ip-monitoring/ip-monitoring.module";
import { cronMonitoringModule } from "@/modules/cron-monitoring/cron-monitoring.module";

/**
 * A scheduled task runs on exactly one cadence — either a fixed interval OR a fixed time of day,
 * never both. `intervalSec` fires every N seconds from boot; `dailyAtMinute` fires once per day
 * when the server clock crosses that minute-of-day. Provide one and leave the other undefined.
 */
export interface ScheduledTask {
  /** Owning module slug — recorded in cron logs. */
  module: string;
  /** Interval cadence: how often to run, in seconds. Mutually exclusive with `dailyAtMinute`. */
  intervalSec?: number;
  /**
   * Daily-at-time cadence: minutes since local midnight (0–1439; e.g. 1439 = 23:59). The task
   * fires once on the first tick at or after this minute each day. Server timezone. Mutually
   * exclusive with `intervalSec`.
   */
  dailyAtMinute?: number;
  /** The work. Should resolve when the run is complete. */
  run: () => Promise<void>;
}

export interface ModuleManifest {
  /** Module slug. For feature modules this must match a `modules.slug` row; behavior runs only when
   * that row is active. Infra modules (`infra: true`) have no DB row and are never gated. */
  key: string;
  /**
   * Infra module: pure IoC wiring with no user-facing nav and no DB row. Its `init()` runs
   * unconditionally at startup (not gated by `modules` status), because feature modules depend on
   * the slot it registers (e.g. the notification dispatcher, the cron run-logger).
   */
  infra?: boolean;
  /** One-time startup wiring (e.g. register a notification dispatcher). Optional. */
  init?: () => void;
  /** Tasks this module wants the in-process scheduler to run on an interval. Optional. */
  scheduledTasks?: ScheduledTask[];
  /**
   * True when this module calls `notifyModule(...)`, i.e. a notification target scoped to it can
   * actually fire. Drives the scope picker: a nav-only module (Settings) or an infra module would
   * otherwise be offered as a scope that silently never delivers.
   */
  emitsNotifications?: boolean;
}

const MANIFESTS: ModuleManifest[] = [
  notificationModule,
  cronModule,
  pciModule,
  healthMonitoringModule,
  ipMonitoringModule,
  cronMonitoringModule,
];

/**
 * Slugs of modules that emit notifications — the manifests declaring `emitsNotifications`.
 * Independent of DB status: this answers "can this module ever alert?", not "is it on right now".
 */
export function notifyingModuleSlugs(): Set<string> {
  return new Set(MANIFESTS.filter((m) => m.emitsNotifications).map((m) => m.key));
}

/** Slugs of every `status = active` module row. A manifest whose slug is absent is skipped. */
async function activeSlugs(): Promise<Set<string>> {
  const rows = await AppDataSource.getRepository(Module).find({ where: { status: "active" } });
  return new Set(rows.map((m) => m.slug));
}

let initialized = false;

/**
 * Run each module's one-time startup wiring exactly once per process. Infra modules (`infra: true`)
 * always init — feature modules depend on the IoC slots they register. Feature modules init only
 * when their `modules` row is `status = active`; an inactive/missing row is skipped.
 */
export async function initAll(): Promise<void> {
  if (initialized) return;
  const active = await activeSlugs();
  for (const m of MANIFESTS) {
    if (!m.infra && !active.has(m.key)) continue;
    m.init?.();
  }
  initialized = true;
}

/**
 * Collect scheduled tasks from every active module. Consumed by the in-process scheduler. Tasks
 * of an inactive/missing module are excluded, so a DB-disabled module's cron simply doesn't run.
 */
export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  const active = await activeSlugs();
  return MANIFESTS.filter((m) => active.has(m.key)).flatMap((m) => m.scheduledTasks ?? []);
}

/** The serializable cadence of one scheduled task (no `run` fn). */
export interface ModuleScheduleInfo {
  module: string;
  intervalSec?: number;
  dailyAtMinute?: number;
}

/**
 * Cadence of every active module's scheduled tasks, without the (non-serializable) `run` fn. Same
 * active-only filter as `getScheduledTasks`, so this reflects what the scheduler will actually run.
 * The UI uses it to show each module's real schedule.
 */
export async function getModuleSchedules(): Promise<ModuleScheduleInfo[]> {
  const active = await activeSlugs();
  return MANIFESTS.filter((m) => active.has(m.key)).flatMap((m) =>
    (m.scheduledTasks ?? []).map((t) => ({
      module: t.module,
      intervalSec: t.intervalSec,
      dailyAtMinute: t.dailyAtMinute,
    })),
  );
}
