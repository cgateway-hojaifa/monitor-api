import { AppDataSource } from "@/config/data-source";
import { HealthMonitor } from "@/entities/HealthMonitor";
import { Heartbeat } from "@/entities/Heartbeat";
import { notifyModule } from "@/shared/notify";
import { renderMonitorDown } from "@/modules/health-monitoring/services/notifyTemplate";

/**
 * Pure single-monitor runner: send the request, measure latency, classify up/down, write one
 * heartbeat, update the monitor's `last_checked_at`, and fire a notification when the last
 * `fail_threshold` heartbeats are consecutively Down. Identical whether triggered by the
 * scheduler or a manual check.
 */

const monitorRepo = () => AppDataSource.getRepository(HealthMonitor);
const heartbeatRepo = () => AppDataSource.getRepository(Heartbeat);

const DEFAULT_TIMEOUT_MS = 10_000;

export interface CheckResult {
  monitor_id: number;
  status: "up" | "down";
  status_code: number | null;
  ping_ms: number | null;
  message: string;
}

function parseJson(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function checkMonitor(monitor: HealthMonitor): Promise<CheckResult> {
  const start = Date.now();
  let status: "up" | "down" = "down";
  let statusCode: number | null = null;
  let pingMs: number | null = null;
  let message = "";

  try {
    const headers = parseJson(monitor.request_headers) || {};
    const hasBody = ["POST", "PUT", "PATCH"].includes(monitor.method) && !!monitor.request_body;
    // Default Content-Type for a body, but let an explicit user header win.
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");

    const res = await fetch(monitor.url, {
      method: monitor.method,
      headers: {
        ...(hasBody && !hasContentType ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: hasBody ? monitor.request_body! : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      redirect: "manual",
    });

    pingMs = Date.now() - start;
    statusCode = res.status;
    const isUp = res.status >= 200 && res.status <= 299;
    status = isUp ? "up" : "down";
    message = `${res.status} - ${res.statusText || (isUp ? "OK" : "Error")}`.slice(0, 255);
  } catch (err: unknown) {
    pingMs = Date.now() - start;
    const name = (err as { name?: string })?.name;
    message =
      name === "TimeoutError" || name === "AbortError"
        ? "Timeout"
        : (err instanceof Error ? err.message : "Connection error").slice(0, 255);
    status = "down";
  }

  const checkedAt = new Date();
  await heartbeatRepo().save(
    heartbeatRepo().create({
      monitor_id: monitor.id,
      status,
      status_code: statusCode,
      ping_ms: pingMs,
      message,
      checked_at: checkedAt,
    }),
  );
  monitor.last_checked_at = checkedAt;
  await monitorRepo().save(monitor);

  if (status === "down") {
    await maybeNotify(monitor).catch((err) =>
      console.error("[HealthMonitor] Notify failed:", err?.message),
    );
  }

  return { monitor_id: monitor.id, status, status_code: statusCode, ping_ms: pingMs, message };
}

/**
 * Fire a notification whenever the latest `fail_threshold` heartbeats are all Down. This
 * runs on every check, so once the consecutive-failure count reaches the threshold it alerts
 * on that check and on every subsequent Down check, until a successful check breaks the run.
 */
async function maybeNotify(monitor: HealthMonitor): Promise<void> {
  const threshold = monitor.fail_threshold || 2;
  const recent = await heartbeatRepo().find({
    where: { monitor_id: monitor.id },
    order: { checked_at: "DESC" },
    take: threshold,
  });

  if (recent.length < threshold) return;
  if (!recent.every((h) => h.status === "down")) return;

  const latest = recent[0];
  await notifyModule(
    "health-monitoring",
    renderMonitorDown({
      monitor_id: monitor.id,
      monitor_name: monitor.name,
      url: monitor.url,
      status_code: latest.status_code,
      message: latest.message || "Down",
      checked_at: latest.checked_at,
      fail_count: threshold,
    }),
  );
}
