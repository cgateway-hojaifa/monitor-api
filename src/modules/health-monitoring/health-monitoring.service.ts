import { MoreThanOrEqual, Like, IsNull, type FindOptionsWhere } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { HealthMonitor, type HttpMethod } from "@/entities/HealthMonitor";
import { Heartbeat } from "@/entities/Heartbeat";
import { Category } from "@/entities/Category";
import { assertCategoryExists } from "@/modules/category/category.service";
import { checkMonitor } from "@/modules/health-monitoring/services/checkMonitor";
import { checkAllMonitors } from "@/modules/health-monitoring/services/runner";
import { runWithLog } from "@/shared/cron";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

const monitorRepo = () => AppDataSource.getRepository(HealthMonitor);
const heartbeatRepo = () => AppDataSource.getRepository(Heartbeat);
const categoryRepo = () => AppDataSource.getRepository(Category);

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Normalize an incoming `category_id`: absent/empty/null → null (uncategorized), else a positive
 * integer that must name an existing category (`assertCategoryExists` throws 400 if it doesn't).
 * `undefined` means "not supplied" and is returned as-is so update can leave the field untouched.
 */
async function normalizeCategoryId(raw: unknown): Promise<number | null | undefined> {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw new ApiError(httpStatus.BAD_REQUEST, "category_id must be a positive integer.");
  await assertCategoryExists(id);
  return id;
}

/**
 * Normalize + validate the optional request_headers / request_body fields.
 * Headers must be a JSON object; body must be valid JSON. Empty → null. Body is only kept
 * for methods that carry one (POST/PUT/PATCH). Returns a validation error string, or null.
 */
function normalizeRequestFields(b: {
  request_headers?: unknown;
  request_body?: unknown;
  method: HttpMethod;
}): { headers: string | null; body: string | null } | string {
  let headers: string | null = null;
  const rawHeaders = typeof b.request_headers === "string" ? b.request_headers.trim() : "";
  if (rawHeaders) {
    try {
      const parsed = JSON.parse(rawHeaders);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return "request_headers must be a JSON object.";
      headers = rawHeaders;
    } catch {
      return "request_headers must be valid JSON.";
    }
  }

  let body: string | null = null;
  const carriesBody = ["POST", "PUT", "PATCH"].includes(b.method);
  const rawBody = typeof b.request_body === "string" ? b.request_body.trim() : "";
  if (carriesBody && rawBody) {
    try {
      JSON.parse(rawBody);
      body = rawBody;
    } catch {
      return "request_body must be valid JSON.";
    }
  }

  return { headers, body };
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOWS = {
  "24h": 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
  "1y": 365 * 24 * HOUR_MS,
} as const;

/** Uptime% over the trailing window, from heartbeats. Null if no beats in window. */
async function uptimeFor(monitorId: number, windowMs: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMs);
  const [total, up] = await Promise.all([
    heartbeatRepo().count({ where: { monitor_id: monitorId, checked_at: MoreThanOrEqual(since) } }),
    heartbeatRepo().count({
      where: { monitor_id: monitorId, checked_at: MoreThanOrEqual(since), status: "up" },
    }),
  ]);
  return total > 0 ? Math.round((up / total) * 1000) / 10 : null;
}

/** Average response time (ms) over the trailing window. Null if no timed beats. */
async function avgPingFor(monitorId: number, windowMs: number): Promise<number | null> {
  const since = new Date(Date.now() - windowMs);
  const raw = await heartbeatRepo()
    .createQueryBuilder("hb")
    .select("AVG(hb.ping_ms)", "avg")
    .where("hb.monitor_id = :id", { id: monitorId })
    .andWhere("hb.checked_at >= :since", { since })
    .andWhere("hb.ping_ms IS NOT NULL")
    .getRawOne<{ avg: string | null }>();
  const avg = raw?.avg == null ? null : Number(raw.avg);
  return avg == null || Number.isNaN(avg) ? null : Math.round(avg);
}

/** Latest status + multi-window uptime/avg for a monitor, from heartbeats. */
async function summarize(monitorId: number) {
  const [latest, uptime_24h, uptime_30d, uptime_1y, avg_ping_24h] = await Promise.all([
    heartbeatRepo().findOne({ where: { monitor_id: monitorId }, order: { checked_at: "DESC" } }),
    uptimeFor(monitorId, WINDOWS["24h"]),
    uptimeFor(monitorId, WINDOWS["30d"]),
    uptimeFor(monitorId, WINDOWS["1y"]),
    avgPingFor(monitorId, WINDOWS["24h"]),
  ]);
  return {
    current_status: latest?.status ?? "unknown",
    last_status_code: latest?.status_code ?? null,
    last_ping_ms: latest?.ping_ms ?? null,
    last_checked_at: latest?.checked_at ?? null,
    uptime_24h,
    uptime_30d,
    uptime_1y,
    avg_ping_24h,
  };
}

// ── Collection ────────────────────────────────────────────────────────────────

export async function listMonitors(query: {
  page?: unknown;
  perPage?: unknown;
  q?: unknown;
  category_id?: unknown;
}) {
  const page = Math.max(Number(query.page ?? "1"), 1);
  const perPage = Math.min(Math.max(Number(query.perPage ?? "10"), 1), 100);
  const q = (typeof query.q === "string" ? query.q : "").trim();

  // Category filter: a numeric id narrows to that category; the literal "none" narrows to
  // uncategorized monitors (IsNull); anything else (absent/empty) means no category filter.
  const rawCategory = query.category_id;
  const categoryFilter: FindOptionsWhere<HealthMonitor> | null =
    rawCategory === "none"
      ? { category_id: IsNull() }
      : rawCategory != null && rawCategory !== "" && Number(rawCategory) > 0
        ? { category_id: Number(rawCategory) }
        : null;

  // Optional name/url search. TypeORM treats an array of where-objects as OR, so the category
  // filter must be merged into *each* branch to stay ANDed with the search.
  const searchBranches: FindOptionsWhere<HealthMonitor>[] | null = q
    ? [{ name: Like(`%${q}%`) }, { url: Like(`%${q}%`) }]
    : null;
  const where: FindOptionsWhere<HealthMonitor> | FindOptionsWhere<HealthMonitor>[] | undefined =
    searchBranches
      ? searchBranches.map((branch) => ({ ...branch, ...(categoryFilter ?? {}) }))
      : (categoryFilter ?? undefined);

  const total = await monitorRepo().count(where ? { where } : {});
  const monitors = await monitorRepo().find({
    ...(where ? { where } : {}),
    order: { created_at: "DESC" },
    take: perPage,
    skip: (page - 1) * perPage,
  });

  // Resolve the page's categories in one query so each row can carry its label/colour.
  const categories = await categoryRepo().find();
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Only summarize the current page's monitors (each summarize() = several queries).
  const data = await Promise.all(
    monitors.map(async (m) => ({
      ...m,
      ...(await summarize(m.id)),
      category: m.category_id ? (categoryMap.get(m.category_id) ?? null) : null,
    })),
  );

  // Up/down counts for the summary cards: across every monitor matching the current filter (not
  // just this page), so the cards agree with what the filter is showing.
  const allMonitors = await monitorRepo().find({ ...(where ? { where } : {}), select: ["id"] });
  const allStatuses = await Promise.all(
    allMonitors.map(async (m) => {
      const latest = await heartbeatRepo().findOne({
        where: { monitor_id: m.id },
        order: { checked_at: "DESC" },
      });
      return latest?.status ?? "unknown";
    }),
  );
  const upCount = allStatuses.filter((s) => s === "up").length;
  const downCount = allStatuses.filter((s) => s === "down").length;

  return { data, total, page, perPage, upCount, downCount };
}

export async function createMonitor(b: any) {
  if (!b.name?.trim() || !b.url?.trim())
    throw new ApiError(httpStatus.BAD_REQUEST, "Name and URL are required.");
  const method: HttpMethod = METHODS.includes(b.method) ? b.method : "GET";
  const normalized = normalizeRequestFields({ ...b, method });
  if (typeof normalized === "string") throw new ApiError(httpStatus.BAD_REQUEST, normalized);
  const category_id = await normalizeCategoryId(b.category_id);
  const monitor = monitorRepo().create({
    name: b.name.trim(),
    url: b.url.trim(),
    method,
    request_headers: normalized.headers,
    request_body: normalized.body,
    fail_threshold: Number(b.fail_threshold) > 0 ? Number(b.fail_threshold) : 2,
    active: b.active === false ? false : true,
    category_id: category_id ?? null,
  });
  return monitorRepo().save(monitor);
}

// ── Item ──────────────────────────────────────────────────────────────────────

export async function getMonitor(id: number) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  const category = monitor.category_id
    ? await categoryRepo().findOne({ where: { id: monitor.category_id } })
    : null;
  return { ...monitor, ...(await summarize(monitor.id)), category };
}

export async function updateMonitor(id: number, b: any) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  if (!b.name?.trim() || !b.url?.trim())
    throw new ApiError(httpStatus.BAD_REQUEST, "Name and URL are required.");
  const method: HttpMethod = METHODS.includes(b.method) ? b.method : monitor.method;
  const normalized = normalizeRequestFields({ ...b, method });
  if (typeof normalized === "string") throw new ApiError(httpStatus.BAD_REQUEST, normalized);
  monitor.name = b.name.trim();
  monitor.url = b.url.trim();
  monitor.method = method;
  monitor.request_headers = normalized.headers;
  monitor.request_body = normalized.body;
  monitor.fail_threshold =
    Number(b.fail_threshold) > 0 ? Number(b.fail_threshold) : monitor.fail_threshold;
  monitor.active = b.active === false ? false : b.active === true ? true : monitor.active;
  // `undefined` = field not supplied → leave the existing assignment untouched.
  const category_id = await normalizeCategoryId(b.category_id);
  if (category_id !== undefined) monitor.category_id = category_id;
  return monitorRepo().save(monitor);
}

export async function deleteMonitor(id: number) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  await heartbeatRepo().delete({ monitor_id: monitor.id });
  await monitorRepo().remove(monitor);
}

// ── Clear heartbeats (wipe history, keep the monitor) ─────────────────────────
// Kuma's "Clear Data" → Clear Heartbeats: deletes the monitor's heartbeat records but
// leaves the monitor config ("the API") intact. Events are derived from heartbeats, so
// clearing heartbeats clears the derived event log too.

export async function clearHeartbeats(id: number) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  const res = await heartbeatRepo().delete({ monitor_id: monitor.id });
  return res.affected ?? 0;
}

// ── Heartbeats (history for chart + log) ──────────────────────────────────────

export async function listHeartbeats(id: number, limitRaw?: unknown) {
  const limit = Math.min(Number(limitRaw ?? "100"), 500);
  return heartbeatRepo().find({
    where: { monitor_id: id },
    order: { checked_at: "DESC" },
    take: limit,
  });
}

// ── Important events (state transitions only), paginated ──────────────────────
// Kuma-style: an "event" is a heartbeat whose status differs from the one before it
// (up→down or down→up), plus the very first beat. We derive these by scanning the full
// chronological history for the monitor, then page over the resulting transition list.

export async function listEvents(id: number, query: { page?: unknown; perPage?: unknown }) {
  const page = Math.max(Number(query.page ?? "1"), 1);
  const perPage = Math.min(Math.max(Number(query.perPage ?? "25"), 1), 100);

  const beats = await heartbeatRepo().find({
    where: { monitor_id: id },
    order: { checked_at: "ASC" },
  });

  // Keep only transitions (status change vs. previous beat); first beat always counts.
  const events: Heartbeat[] = [];
  let prev: string | null = null;
  for (const b of beats) {
    if (b.status !== prev) events.push(b);
    prev = b.status;
  }
  events.reverse(); // newest first

  const total = events.length;
  const start = (page - 1) * perPage;
  const data = events.slice(start, start + perPage);
  return { data, total, page, perPage };
}

// ── Manual check (one) ────────────────────────────────────────────────────────

export async function checkOne(id: number) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  return checkMonitor(monitor);
}

// ── Manual check (all) — logged as a manual cron run ──────────────────────────

export async function checkAll() {
  const results = await runWithLog("health-monitoring", "manual", checkAllMonitors);
  return { processed: results.length, data: results };
}

// ── Status (last-30-min heartbeats for every monitor) ─────────────────────────

export async function statusWindow() {
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const rows = await heartbeatRepo().find({
    where: { checked_at: MoreThanOrEqual(since) },
    order: { checked_at: "ASC" },
  });
  const byMonitor: Record<number, Heartbeat[]> = {};
  for (const r of rows) (byMonitor[r.monitor_id] ??= []).push(r);
  return byMonitor;
}

// Re-exported for the module manifest's scheduled task.
export { checkAllMonitors };
