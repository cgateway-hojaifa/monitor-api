import crypto from "crypto";
import { Like, type FindOptionsWhere } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { CronMonitor } from "@/entities/CronMonitor";
import { CronRun } from "@/entities/CronRun";
import { CronDailyResult } from "@/entities/CronDailyResult";
import { countRunsForDay } from "@/modules/cron-monitoring/services/runDailyCheck";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

/**
 * Cron monitoring data layer (PUSH model).
 *
 * A monitor is a definition (name, expected_per_day, auto-generated cron_key). Remote jobs report
 * completed runs through `ingestRun`, keyed by `cron_key`. The daily check (see `runDailyCheck`)
 * turns run counts into pass/fail. This service owns CRUD, the run ledger, and the read models the
 * UI needs (today's actual/expected, run history, daily result history).
 */

const monitorRepo = () => AppDataSource.getRepository(CronMonitor);
const runRepo = () => AppDataSource.getRepository(CronRun);
const resultRepo = () => AppDataSource.getRepository(CronDailyResult);

const MAX_DATA_BYTES = 16 * 1024;

// ── Normalizers ────────────────────────────────────────────────────────────────

function normalizeName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  if (value.length > 150)
    throw new ApiError(httpStatus.BAD_REQUEST, "Name must be 150 characters or fewer.");
  return value;
}

function normalizeExpected(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new ApiError(httpStatus.BAD_REQUEST, "Expected runs per day must be a positive integer.");
  return n;
}

/** A URL-safe, 48-hex-char (24-byte) key. Retried on the astronomically unlikely unique clash. */
async function generateUniqueKey(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const key = crypto.randomBytes(24).toString("hex");
    const clash = await monitorRepo().findOne({ where: { cron_key: key } });
    if (!clash) return key;
  }
  throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, "Could not generate a unique key.");
}

/** Parse a required ISO-ish datetime from the ingest body. Throws on empty/absent/garbage. */
function parseRequiredTime(raw: unknown, field: string): Date {
  if (raw === undefined || raw === null || raw === "")
    throw new ApiError(httpStatus.BAD_REQUEST, `${field} is required.`);
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime()))
    throw new ApiError(httpStatus.BAD_REQUEST, `${field} is not a valid datetime.`);
  return d;
}

// ── Read model ─────────────────────────────────────────────────────────────────

/** Today's counts + last-run info + a 30-day pass rate for a monitor. */
async function summarize(monitor: CronMonitor) {
  const now = new Date();
  const [todayActual, lastRun, results, runsTotal] = await Promise.all([
    countRunsForDay(monitor.id, now),
    // Last run = newest row (one row per completed run).
    runRepo().findOne({
      where: { monitor_id: monitor.id },
      order: { received_at: "DESC" },
    }),
    resultRepo().find({ where: { monitor_id: monitor.id }, order: { day: "DESC" }, take: 30 }),
    // Total completed runs = one row per run.
    runRepo().count({ where: { monitor_id: monitor.id } }),
  ]);

  const evaluated = results.length;
  const passedDays = results.filter((r) => r.passed).length;
  const pass_rate_30d = evaluated > 0 ? Math.round((passedDays / evaluated) * 1000) / 10 : null;

  // Today's live status from counts, independent of whether the daily check has run yet.
  const today_expected = monitor.expected_per_day;
  const today_status: "ok" | "under" | "pending" =
    todayActual >= today_expected ? "ok" : todayActual > 0 ? "under" : "pending";

  return {
    today_actual: todayActual,
    today_expected,
    today_status,
    last_run_at: lastRun?.received_at ?? null,
    last_checked_at: monitor.last_checked_at,
    pass_rate_30d,
    days_evaluated: evaluated,
    runs_total: runsTotal,
  };
}

/** Public shape: the monitor plus its live summary. cron_key IS returned (re-viewable by design). */
async function toPublic(monitor: CronMonitor) {
  return {
    id: monitor.id,
    name: monitor.name,
    cron_key: monitor.cron_key,
    expected_per_day: monitor.expected_per_day,
    active: monitor.active,
    created_at: monitor.created_at,
    updated_at: monitor.updated_at,
    ...(await summarize(monitor)),
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function listMonitors(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 20));
  const q = typeof query.q === "string" ? query.q.trim() : "";

  const where: FindOptionsWhere<CronMonitor> = {};
  if (q) where.name = Like(`%${q}%`);

  const [rows, total] = await monitorRepo().findAndCount({
    where,
    order: { created_at: "DESC" },
    skip: (page - 1) * perPage,
    take: perPage,
  });

  const data = await Promise.all(rows.map(toPublic));
  const okCount = data.filter((d) => d.today_status === "ok").length;
  const failCount = data.filter((d) => d.today_status === "under").length;
  return { data, total, page, perPage, okCount, failCount };
}

async function getEntity(id: number): Promise<CronMonitor> {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Cron monitor not found.");
  return monitor;
}

export async function getMonitor(id: number) {
  return toPublic(await getEntity(id));
}

export async function createMonitor(body: Record<string, unknown>) {
  const name = normalizeName(body.name);
  const expected_per_day = normalizeExpected(body.expected_per_day);
  const active = body.active === undefined ? true : Boolean(body.active);
  const cron_key = await generateUniqueKey();

  const monitor = monitorRepo().create({ name, expected_per_day, active, cron_key });
  await monitorRepo().save(monitor);
  return toPublic(monitor);
}

export async function updateMonitor(id: number, body: Record<string, unknown>) {
  const monitor = await getEntity(id);
  if (body.name !== undefined) monitor.name = normalizeName(body.name);
  if (body.expected_per_day !== undefined)
    monitor.expected_per_day = normalizeExpected(body.expected_per_day);
  if (body.active !== undefined) monitor.active = Boolean(body.active);
  await monitorRepo().save(monitor);
  return toPublic(monitor);
}

export async function deleteMonitor(id: number) {
  const monitor = await getEntity(id);
  // Clear the ledger + audit rows first (no FK cascade defined; keep the tables consistent).
  await runRepo().delete({ monitor_id: id });
  await resultRepo().delete({ monitor_id: id });
  await monitorRepo().remove(monitor);
}

/** Rotate the shared secret. Old key stops working immediately. */
export async function regenerateKey(id: number) {
  const monitor = await getEntity(id);
  monitor.cron_key = await generateUniqueKey();
  await monitorRepo().save(monitor);
  return toPublic(monitor);
}

// ── Ingest (PUSH) ────────────────────────────────────────────────────────────────

/**
 * Record one completed run. `key` comes from the `X-Cron-Key` header; an unknown key is a 404.
 *
 * The job POSTs ONCE, after finishing, with both `start_time` and `end_time` (both required) and an
 * optional opaque `data` blob. Each call inserts one row and counts as one completed cycle.
 */
export async function ingestRun(
  key: string,
  body: { start_time?: unknown; end_time?: unknown; data?: unknown },
) {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) throw new ApiError(httpStatus.UNAUTHORIZED, "Missing X-Cron-Key header.");

  const monitor = await monitorRepo().findOne({ where: { cron_key: trimmed } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Unknown cron key.");
  if (!monitor.active)
    throw new ApiError(httpStatus.FORBIDDEN, "This cron monitor is inactive; runs are not accepted.");

  // `data` is opaque but bounded — reject an oversized blob rather than bloat the row.
  const data: unknown = body.data ?? null;
  if (data !== null && Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_DATA_BYTES)
    throw new ApiError(httpStatus.BAD_REQUEST, `data exceeds ${MAX_DATA_BYTES} bytes.`);

  const start_time = parseRequiredTime(body.start_time, "start_time");
  const end_time = parseRequiredTime(body.end_time, "end_time");
  if (end_time.getTime() < start_time.getTime())
    throw new ApiError(httpStatus.BAD_REQUEST, "end_time must be at or after start_time.");

  const run = runRepo().create({
    monitor_id: monitor.id,
    start_time,
    end_time,
    data,
    received_at: new Date(),
  });
  await runRepo().save(run);

  return {
    id: run.id,
    monitor_id: monitor.id,
    start_time: run.start_time,
    end_time: run.end_time,
    received_at: run.received_at,
  };
}

// ── History read models ──────────────────────────────────────────────────────────

/** Recent run rows for a monitor (newest first). */
export async function listRuns(id: number, limitRaw: unknown) {
  await getEntity(id); // 404 if the monitor is gone
  const limit = Math.min(500, Math.max(1, Number(limitRaw) || 100));
  const runs = await runRepo().find({
    where: { monitor_id: id },
    order: { received_at: "DESC" },
    take: limit,
  });
  return runs.map((r) => ({
    id: r.id,
    start_time: r.start_time,
    end_time: r.end_time,
    data: r.data,
    received_at: r.received_at,
  }));
}

/** Daily pass/fail history for a monitor (newest day first). */
export async function listDailyResults(id: number, limitRaw: unknown) {
  await getEntity(id);
  const limit = Math.min(365, Math.max(1, Number(limitRaw) || 30));
  const rows = await resultRepo().find({
    where: { monitor_id: id },
    order: { day: "DESC" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    day: r.day,
    expected: r.expected,
    actual: r.actual,
    passed: r.passed,
    notified: r.notified,
    created_at: r.created_at,
  }));
}
