import { AppDataSource } from "@/config/data-source";
import { Notification } from "@/entities/Notification";
import { resolveModules } from "@/notifications/store";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";
import type { ModuleKey } from "@/shared/contracts/notification";
import { validModuleScopeKeys } from "@/modules/module/module.service";

/**
 * Notification target CRUD. The delivery/sending logic lives in `@/notifications/` (dispatch +
 * store); this module owns the managed list of targets the UI edits.
 */

const notifRepo = () => AppDataSource.getRepository(Notification);

/**
 * Validate/dedupe a request `modules` value into a non-empty scope list (default `["global"]`).
 *
 * Scopes are checked against the live `modules` table rather than a list in this file: the old
 * hardcoded copy went stale the moment `ip-monitoring` was added, and unknown scopes are dropped
 * silently, so the bug surfaced only as a target that never fired.
 */
async function normalizeModules(value: unknown): Promise<ModuleKey[]> {
  const arr = Array.isArray(value) ? value : value != null ? [value] : [];
  const valid = await validModuleScopeKeys();
  const kept = arr.filter((v): v is ModuleKey => typeof v === "string" && valid.has(v));
  const deduped = Array.from(new Set(kept));
  return deduped.length > 0 ? deduped : ["global"];
}

/** Serialize a row for the client, always exposing a resolved `modules` array. */
function serialize(row: Notification) {
  return { ...row, modules: resolveModules(row) };
}

function validateBody(body: { type?: string; name?: string; target?: string }): string | null {
  if (!body.type || !body.name?.trim() || !body.target?.trim())
    return "Type, name and target are required.";
  if (!["email", "slack"].includes(body.type)) return "Type must be email or slack.";
  return null;
}

export async function listNotifications(moduleFilter?: string) {
  const rows = await notifRepo().find({ order: { created_at: "DESC" } });
  let data = rows.map(serialize);
  if (moduleFilter && (await validModuleScopeKeys()).has(moduleFilter)) {
    data = data.filter((r) => r.modules.includes(moduleFilter));
  }
  return data;
}

export async function getNotification(id: number) {
  const row = await notifRepo().findOne({ where: { id } });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, "Not found.");
  return serialize(row);
}

export async function createNotification(body: Record<string, unknown>) {
  const err = validateBody(body as never);
  if (err) throw new ApiError(httpStatus.BAD_REQUEST, err);
  const row = notifRepo().create({
    type: body.type as "email" | "slack",
    name: (body.name as string).trim(),
    target: (body.target as string).trim(),
    status: body.status === "inactive" ? "inactive" : "active",
    modules: await normalizeModules(body.modules),
    module: null,
  });
  await notifRepo().save(row);
  return serialize(row);
}

export async function updateNotification(id: number, body: Record<string, unknown>) {
  const row = await notifRepo().findOne({ where: { id } });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, "Not found.");
  const err = validateBody(body as never);
  if (err) throw new ApiError(httpStatus.BAD_REQUEST, err);
  row.type = body.type as "email" | "slack";
  row.name = (body.name as string).trim();
  row.target = (body.target as string).trim();
  row.status = body.status === "inactive" ? "inactive" : "active";
  row.modules = await normalizeModules(body.modules);
  row.module = null;
  await notifRepo().save(row);
  return serialize(row);
}

export async function deleteNotification(id: number) {
  const row = await notifRepo().findOne({ where: { id } });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, "Not found.");
  await notifRepo().remove(row);
}
