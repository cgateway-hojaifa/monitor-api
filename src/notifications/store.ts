import { Not, IsNull } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { Notification } from "@/entities/Notification";
import type { ModuleKey, NotificationTarget } from "@/shared/contracts/notification";

/**
 * Notification target store — the read/resolve side of the notification sending logic.
 *
 * Lives in the top-level `notifications/` folder (dedicated sending-logic home) rather than in a
 * feature module, because dispatch is cross-cutting: any module notifies through it via the
 * `@/shared/notify` IoC slot. The `notification` feature module owns CRUD of targets; this file
 * owns resolving which targets are active for a given module scope.
 */

const repo = () => AppDataSource.getRepository(Notification);

/**
 * Coalesce a row's module scopes into a normalized array. Prefers `modules` (JSON array);
 * falls back to the legacy single `module` column. Always returns a non-empty array.
 */
export function resolveModules(row: { modules?: unknown; module?: string | null }): ModuleKey[] {
  const list = Array.isArray(row.modules) ? (row.modules as ModuleKey[]) : [];
  if (list.length > 0) return list;
  if (row.module) return [row.module as ModuleKey];
  return ["global"];
}

/**
 * One-time migration from the legacy single `module` column to the `modules` JSON array.
 * Idempotent: only touches rows where `module IS NOT NULL`.
 */
export async function backfillNotificationModules(): Promise<void> {
  const legacy = await repo().find({ where: { module: Not(IsNull()) } });
  for (const row of legacy) {
    const key = (row.module as ModuleKey) || "global";
    row.modules = [key];
    row.module = null;
    await repo().save(row);
  }
}

/**
 * Resolve active delivery targets for a module: any active target whose scopes include the
 * module key or `"global"`. Scope matching is in JS (scopes live in a JSON column).
 */
export async function getActiveTargets(moduleKey: ModuleKey): Promise<NotificationTarget[]> {
  const rows = await repo().find({ where: { status: "active" } });

  return rows
    .map((n) => ({
      type: n.type,
      name: n.name,
      target: n.target,
      status: n.status,
      modules: resolveModules(n),
    }))
    .filter((t) => t.modules.includes("global") || t.modules.includes(moduleKey));
}
