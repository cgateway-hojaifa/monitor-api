import { AppDataSource } from "@/config/data-source";
import { IpMonitor } from "@/entities/IpMonitor";
import { IpHeartbeat } from "@/entities/IpHeartbeat";
import { notifyModule } from "@/shared/notify";
import { renderIpMonitorDown } from "@/modules/ip-monitoring/services/notifyTemplate";
import { tcpProbe } from "@/modules/ip-monitoring/services/tcpProbe";

/**
 * Single IP-monitor runner: TCP-probe the target, write one heartbeat, stamp `last_checked_at`,
 * and notify when the last `fail_threshold` heartbeats are consecutively Down.
 *
 * Same shape as the HTTP module's `checkMonitor`, with one difference: nothing here is wired to
 * the scheduler. This only ever runs from a manual check (one row, or "Check All").
 */

const monitorRepo = () => AppDataSource.getRepository(IpMonitor);
const heartbeatRepo = () => AppDataSource.getRepository(IpHeartbeat);

export interface IpCheckResult {
  monitor_id: number;
  status: "up" | "down";
  ping_ms: number | null;
  message: string;
}

export async function checkIpMonitor(monitor: IpMonitor): Promise<IpCheckResult> {
  const probe = await tcpProbe(monitor.ip_address, monitor.port, monitor.timeout_ms || 5000);

  const checkedAt = new Date();
  await heartbeatRepo().save(
    heartbeatRepo().create({
      monitor_id: monitor.id,
      status: probe.status,
      ping_ms: probe.ping_ms,
      message: probe.message,
      checked_at: checkedAt,
    }),
  );
  monitor.last_checked_at = checkedAt;
  await monitorRepo().save(monitor);

  if (probe.status === "down") {
    await maybeNotify(monitor).catch((err) =>
      console.error("[IpMonitor] Notify failed:", err?.message),
    );
  }

  return {
    monitor_id: monitor.id,
    status: probe.status,
    ping_ms: probe.ping_ms,
    message: probe.message,
  };
}

/**
 * Notify when the latest `fail_threshold` heartbeats are all Down. Because checks are manual,
 * reaching the threshold takes that many triggered checks — there is no unattended escalation.
 */
async function maybeNotify(monitor: IpMonitor): Promise<void> {
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
    "ip-monitoring",
    renderIpMonitorDown({
      monitor_id: monitor.id,
      monitor_name: monitor.name,
      ip_address: monitor.ip_address,
      port: monitor.port,
      message: latest.message || "Down",
      checked_at: latest.checked_at,
      fail_count: threshold,
    }),
  );
}

/**
 * Check every active IP monitor. Called only by the manual "Check All" endpoint — the module
 * registers no scheduled task, so nothing calls this on a timer.
 */
export async function checkAllIpMonitors(): Promise<IpCheckResult[]> {
  const monitors = await monitorRepo().find({ where: { active: true } });
  const settled = await Promise.allSettled(monitors.map((m) => checkIpMonitor(m)));
  return settled
    .filter((r): r is PromiseFulfilledResult<IpCheckResult> => r.status === "fulfilled")
    .map((r) => r.value);
}
