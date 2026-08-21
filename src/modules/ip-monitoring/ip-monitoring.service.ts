import net from "net";
import { MoreThanOrEqual, Like, IsNull, type FindOptionsWhere } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { IpMonitor } from "@/entities/IpMonitor";
import { IpHeartbeat } from "@/entities/IpHeartbeat";
import { Category } from "@/entities/Category";
import { assertCategoryExists } from "@/modules/category/category.service";
import {
  checkIpMonitor,
  checkAllIpMonitors,
} from "@/modules/ip-monitoring/services/checkIpMonitor";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

/**
 * IP monitoring data layer — TCP reachability targets (`ip_address:port`).
 *
 * Mirrors the health-monitoring service (uptime windows from heartbeats, category filter,
 * paginated list) with one deliberate omission: no `runWithLog` / scheduler surface. These
 * monitors are checked only when a user triggers a check, so there is no cron run to log.
 */

const monitorRepo = () => AppDataSource.getRepository(IpMonitor);
const heartbeatRepo = () => AppDataSource.getRepository(IpHeartbeat);
const categoryRepo = () => AppDataSource.getRepository(Category);

const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;

/** Hostname per RFC 1123 (labels of alphanumerics/hyphens). Accepted alongside IP literals. */
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validate the probe target. `net.isIP` covers IPv4/IPv6 literals; a hostname is allowed too
 * since operators often track a box by DNS name. Anything else (URL, "ip:port" pasted whole,
 * empty) is rejected here rather than failing later inside the socket layer.
 */
function normalizeIpAddress(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new ApiError(httpStatus.BAD_REQUEST, "IP address is required.");
  if (value.includes("/") || value.includes(" "))
    throw new ApiError(httpStatus.BAD_REQUEST, "IP address must be a bare host, not a URL.");
  // A pasted "1.2.3.4:8443" is a common mistake — name the fix instead of a generic error.
  if (net.isIP(value) === 0 && /^[\d.]+:\d+$/.test(value))
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Enter the IP address and port in separate fields (e.g. 46.232.248.109 and 8443).",
    );
  if (net.isIP(value) === 0 && !HOSTNAME_RE.test(value))
    throw new ApiError(httpStatus.BAD_REQUEST, "Must be a valid IP address or hostname.");
  return value;
}

function normalizePort(raw: unknown): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ApiError(httpStatus.BAD_REQUEST, "Port must be an integer between 1 and 65535.");
  return port;
}

function normalizeTimeout(raw: unknown, fallback = DEFAULT_TIMEOUT_MS): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS)
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} ms.`,
    );
  return ms;
}

/** Same contract as the health-monitoring service: `undefined` = not supplied, null = clear. */
async function normalizeCategoryId(raw: unknown): Promise<number | null | undefined> {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw new ApiError(httpStatus.BAD_REQUEST, "category_id must be a positive integer.");
  await assertCategoryExists(id);
  return id;
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOWS = {
  "24h": 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
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

/** Latest status + uptime windows for a monitor, derived from its heartbeats. */
async function summarize(monitorId: number) {
  const [latest, uptime_24h, uptime_30d, checks_total] = await Promise.all([
    heartbeatRepo().findOne({ where: { monitor_id: monitorId }, order: { checked_at: "DESC" } }),
    uptimeFor(monitorId, WINDOWS["24h"]),
    uptimeFor(monitorId, WINDOWS["30d"]),
    heartbeatRepo().count({ where: { monitor_id: monitorId } }),
  ]);
  return {
    current_status: latest?.status ?? "unknown",
    last_ping_ms: latest?.ping_ms ?? null,
    last_message: latest?.message ?? null,
    last_checked_at: latest?.checked_at ?? null,
    uptime_24h,
    uptime_30d,
    checks_total,
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

  const rawCategory = query.category_id;
  const categoryFilter: FindOptionsWhere<IpMonitor> | null =
    rawCategory === "none"
      ? { category_id: IsNull() }
      : rawCategory != null && rawCategory !== "" && Number(rawCategory) > 0
        ? { category_id: Number(rawCategory) }
        : null;

  // Array of where-objects is OR in TypeORM, so the category filter is merged into each branch
  // to stay ANDed with the search.
  const searchBranches: FindOptionsWhere<IpMonitor>[] | null = q
    ? [{ name: Like(`%${q}%`) }, { ip_address: Like(`%${q}%`) }]
    : null;
  const where: FindOptionsWhere<IpMonitor> | FindOptionsWhere<IpMonitor>[] | undefined =
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

  const categories = await categoryRepo().find();
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const data = await Promise.all(
    monitors.map(async (m) => ({
      ...m,
      ...(await summarize(m.id)),
      category: m.category_id ? (categoryMap.get(m.category_id) ?? null) : null,
    })),
  );

  // Up/down counts across everything matching the current filter, so the cards agree with the list.
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
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");

  const category_id = await normalizeCategoryId(b.category_id);
  const monitor = monitorRepo().create({
    name,
    ip_address: normalizeIpAddress(b.ip_address),
    port: normalizePort(b.port),
    timeout_ms: normalizeTimeout(b.timeout_ms),
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

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");

  monitor.name = name;
  monitor.ip_address = normalizeIpAddress(b.ip_address);
  monitor.port = normalizePort(b.port);
  monitor.timeout_ms = normalizeTimeout(b.timeout_ms, monitor.timeout_ms);
  monitor.fail_threshold =
    Number(b.fail_threshold) > 0 ? Number(b.fail_threshold) : monitor.fail_threshold;
  monitor.active = b.active === false ? false : b.active === true ? true : monitor.active;
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

// ── Heartbeats ────────────────────────────────────────────────────────────────

export async function listHeartbeats(id: number, limitRaw?: unknown) {
  const limit = Math.min(Number(limitRaw ?? "100"), 500);
  return heartbeatRepo().find({
    where: { monitor_id: id },
    order: { checked_at: "DESC" },
    take: limit,
  });
}

export async function clearHeartbeats(id: number) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  const res = await heartbeatRepo().delete({ monitor_id: monitor.id });
  return res.affected ?? 0;
}

// ── Manual checks (the only way an IP check ever runs) ─────────────────────────

export async function checkOne(id: number) {
  const monitor = await monitorRepo().findOne({ where: { id } });
  if (!monitor) throw new ApiError(httpStatus.NOT_FOUND, "Monitor not found.");
  return checkIpMonitor(monitor);
}

/**
 * Check every active IP monitor. Not logged as a cron run (unlike health-monitoring's checkAll)
 * because this module has no scheduled task — a run here is always user-initiated.
 */
export async function checkAll() {
  const results = await checkAllIpMonitors();
  return { processed: results.length, data: results };
}
