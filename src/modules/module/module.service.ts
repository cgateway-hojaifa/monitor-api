import { Not } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { Module } from "@/entities/Module";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";
import { notifyingModuleSlugs, getModuleSchedules } from "@/shared/registry";

/**
 * Module metadata CRUD + tree/nav building. This is the read/write side of the DB-driven module
 * system; the behavior registry (`shared/registry.ts`) reads the same table to decide which
 * modules' code runs.
 */

const repo = () => AppDataSource.getRepository(Module);

export interface ModulePayload {
  name: string;
  display_name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  route?: string | null;
  menu_order?: number;
  parent_id?: number | null;
  status?: "active" | "inactive";
  visible?: boolean;
  permissions?: string[];
  config?: Record<string, unknown>;
  feature_flags?: Record<string, boolean>;
  dependencies?: string[];
}

export interface NavNode {
  id: number;
  name: string;
  display_name: string;
  slug: string;
  icon: string | null;
  route: string | null;
  menu_order: number;
  children: NavNode[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function applyDefaults(body: ModulePayload): Partial<Module> {
  return {
    name: body.name,
    display_name: body.display_name,
    slug: body.slug,
    description: body.description ?? null,
    icon: body.icon ?? null,
    route: body.route ?? null,
    menu_order: body.menu_order ?? 0,
    parent_id: body.parent_id ?? null,
    status: body.status ?? "active",
    visible: body.visible ?? true,
    permissions: body.permissions ?? [],
    config: body.config ?? {},
    feature_flags: body.feature_flags ?? {},
    dependencies: body.dependencies ?? [],
  };
}

/** Reject a slug that isn't kebab-case or collides with another module. */
async function assertSlugOk(slug: string, exceptId?: number) {
  if (!SLUG_RE.test(slug))
    throw new ApiError(httpStatus.BAD_REQUEST, "Slug must be kebab-case (lowercase, hyphens).");
  const clash = await repo().findOne({ where: { slug } });
  if (clash && clash.id !== exceptId)
    throw new ApiError(httpStatus.CONFLICT, "Slug already exists.");
}

/** Validate a parent_id exists and doesn't create a cycle (a module can't be its own ancestor). */
async function assertParentOk(parentId: number | null | undefined, selfId?: number) {
  if (parentId == null) return;
  if (parentId === selfId)
    throw new ApiError(httpStatus.BAD_REQUEST, "A module cannot be its own parent.");
  const all = await repo().find();
  const byId = new Map(all.map((m) => [m.id, m]));
  if (!byId.has(parentId)) throw new ApiError(httpStatus.BAD_REQUEST, "Parent module not found.");
  // Walk up from the proposed parent; if we reach selfId, it's a cycle.
  let cursor: number | null = parentId;
  const seen = new Set<number>();
  while (cursor != null) {
    if (cursor === selfId)
      throw new ApiError(httpStatus.BAD_REQUEST, "Parent assignment would create a cycle.");
    if (seen.has(cursor)) break; // pre-existing cycle guard
    seen.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }
}

/**
 * Derive a module's page route from its parent chain so routes mirror the hierarchy
 * (e.g. Health Monitoring → Monitors ⇒ `/health-monitoring/monitors`).
 *
 * Rule:
 *  - Root (no parent): route = `/<slug>` unless an explicit route was given.
 *  - Child: route = `<parent route base>/<leaf>`, where the parent's base is its own route (or
 *    `/<parent slug>` if the parent is a section with no route of its own), and `<leaf>` is the
 *    last hyphen-group of the child's slug — or, if the caller passed an explicit single-segment
 *    route, that segment. An explicit multi-segment route (already hierarchical, e.g. the seeded
 *    `/pci/dashboard`) is respected as-is so existing pages keep their physical paths.
 */
async function deriveRoute(
  body: ModulePayload,
  parentId: number | null | undefined,
): Promise<string | null> {
  const explicit = body.route?.trim() || null;

  // A caller-provided route that is already a full path (has a slash after the leading one) is
  // taken verbatim — this preserves the seeded pages' physical routes.
  if (explicit && explicit.replace(/^\//, "").includes("/")) return explicit;

  const leaf = (explicit ? explicit.replace(/^\//, "") : body.slug.split("-").pop()) || body.slug;

  if (parentId == null) {
    // Root: prefer an explicit leaf, else the slug itself.
    return `/${explicit ? leaf : body.slug}`;
  }

  const parent = await repo().findOne({ where: { id: parentId } });
  const base = (parent?.route || (parent ? `/${parent.slug}` : "")).replace(/\/$/, "");
  return `${base}/${leaf}`;
}

/** Validate every dependency slug refers to an existing module. */
async function assertDepsOk(deps: string[] | undefined) {
  if (!deps || deps.length === 0) return;
  const existing = await repo().find();
  const slugs = new Set(existing.map((m) => m.slug));
  const missing = deps.filter((d) => !slugs.has(d));
  if (missing.length > 0)
    throw new ApiError(httpStatus.BAD_REQUEST, `Unknown dependency: ${missing.join(", ")}`);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** Flat list for the admin table (all modules, ordered for stable display). */
export async function listModules() {
  return repo().find({ order: { parent_id: "ASC", menu_order: "ASC", id: "ASC" } });
}

export async function getModule(id: number) {
  const row = await repo().findOne({ where: { id } });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, "Module not found.");
  return row;
}

export async function createModule(body: ModulePayload) {
  await assertSlugOk(body.slug);
  await assertParentOk(body.parent_id);
  await assertDepsOk(body.dependencies);
  const fields = applyDefaults(body);
  // Route follows the parent hierarchy (roots first, then children under them).
  fields.route = await deriveRoute(body, body.parent_id ?? null);
  const row = repo().create(fields);
  return repo().save(row);
}

export async function updateModule(id: number, body: ModulePayload) {
  const row = await repo().findOne({ where: { id } });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, "Module not found.");
  await assertSlugOk(body.slug, id);
  await assertParentOk(body.parent_id, id);
  await assertDepsOk(body.dependencies);
  const fields = applyDefaults(body);
  // Route is derived from the parent chain only at creation. On update the caller's route wins
  // verbatim (including null), so an edited route is never recomputed away.

  // Fields the admin form doesn't submit keep their stored value rather than being reset to the
  // `applyDefaults` empty default, so an edit can't silently wipe them.
  if (body.description === undefined) fields.description = row.description;
  if (body.permissions === undefined) fields.permissions = row.permissions;
  if (body.config === undefined) fields.config = row.config;
  if (body.feature_flags === undefined) fields.feature_flags = row.feature_flags;
  if (body.dependencies === undefined) fields.dependencies = row.dependencies;

  Object.assign(row, fields);
  return repo().save(row);
}

export async function deleteModule(id: number) {
  const row = await repo().findOne({ where: { id } });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, "Module not found.");

  const children = await repo().count({ where: { parent_id: id } });
  if (children > 0)
    throw new ApiError(httpStatus.BAD_REQUEST, "Remove or reassign child modules first.");

  const dependents = await repo().find({ where: { id: Not(id) } });
  const blocking = dependents.filter((m) => m.dependencies.includes(row.slug));
  if (blocking.length > 0)
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Other modules depend on "${row.slug}": ${blocking.map((m) => m.slug).join(", ")}`,
    );

  await repo().remove(row);
}

// ── Nav tree ─────────────────────────────────────────────────────────────────

/**
 * Build the navigation tree for the sidebar: active + visible modules only, ordered by
 * menu_order, nested under their parents. `allowed` is the set of module ids the caller may see
 * (permission-filtered by the controller). A parent is included if it (and its perms) pass; an
 * empty section (parent with no visible children and no route of its own) is dropped.
 */
export async function buildNavTree(allowed: (m: Module) => boolean): Promise<NavNode[]> {
  const rows = (await repo().find()).filter(
    (m) => m.status === "active" && m.visible && allowed(m),
  );

  const toNode = (m: Module): NavNode => ({
    id: m.id,
    name: m.name,
    display_name: m.display_name,
    slug: m.slug,
    icon: m.icon,
    route: m.route,
    menu_order: m.menu_order,
    children: [],
  });

  const byId = new Map(rows.map((m) => [m.id, toNode(m)]));
  const roots: NavNode[] = [];

  for (const m of rows) {
    const node = byId.get(m.id)!;
    if (m.parent_id == null) {
      // Top-level section.
      roots.push(node);
    } else if (byId.has(m.parent_id)) {
      // Parent is present (active + visible + permitted) → nest under it.
      byId.get(m.parent_id)!.children.push(node);
    }
    // else: parent was filtered out (inactive/hidden/unpermitted) → drop this child too,
    // never promote it to a top-level item.
  }

  const sortRec = (nodes: NavNode[]) => {
    nodes.sort((a, b) => a.menu_order - b.menu_order || a.id - b.id);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);

  // Drop empty sections (parent with neither a route nor visible children).
  return roots.filter((n) => n.route != null || n.children.length > 0);
}

/** Slugs of every active module — consumed by the behavior registry to gate code execution. */
export async function activeModuleSlugs(): Promise<Set<string>> {
  const rows = await repo().find({ where: { status: "active" } });
  return new Set(rows.map((m) => m.slug));
}

// ── Module scopes (notification targeting) ───────────────────────────────────

/** The scope every module's alerts reach. Not a `modules` row — it has no module of its own. */
export const GLOBAL_SCOPE = { key: "global", label: "Global (all modules)" };

export interface ModuleScope {
  key: string;
  label: string;
}

/**
 * Selectable module scopes for notification targeting — a new module appears here with no code
 * change beyond its manifest. The single source of truth for "which modules can be alerted on?".
 *
 * An active `modules` row that also declares `emitsNotifications` in its manifest. Both halves
 * matter:
 *  - DB row → the module exists and is switched on (Module Management can disable it).
 *  - Manifest flag → the module actually calls `notifyModule`. Without this, nav-only containers
 *    (Settings) and infra rows (cron, category) would be offered as scopes that never deliver.
 *
 * `global` is prepended: it isn't a row, but it's a valid scope meaning "every module".
 */
export async function listModuleScopes(): Promise<ModuleScope[]> {
  const emitters = notifyingModuleSlugs();
  const rows = await repo().find({
    where: { status: "active" },
    order: { menu_order: "ASC", id: "ASC" },
  });
  return [
    GLOBAL_SCOPE,
    ...rows
      .filter((m) => emitters.has(m.slug))
      .map((m) => ({ key: m.slug, label: m.display_name })),
  ];
}

/** Valid scope keys for runtime validation (`global` + every active top-level module slug). */
export async function validModuleScopeKeys(): Promise<Set<string>> {
  return new Set((await listModuleScopes()).map((s) => s.key));
}

// ── Module schedules (topbar "auto-check" line) ──────────────────────────────────

export interface ModuleSchedule {
  /** Module slug the schedule belongs to. */
  module: string;
  /** Cadence kind. */
  kind: "interval" | "daily";
  /** Raw cadence value (seconds for interval, minute-of-day 0–1439 for daily). */
  value: number;
  /** Human label, server-timezone (e.g. "Daily at 23:59", "Every 60s"). */
  label: string;
}

/** "23:59" from a minute-of-day. */
function minuteOfDayToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A short human cadence label for an interval given in seconds. */
function intervalLabel(sec: number): string {
  if (sec % 3600 === 0) return `Every ${sec / 3600}h`;
  if (sec % 60 === 0) return `Every ${sec / 60}m`;
  return `Every ${sec}s`;
}

/**
 * Schedules of every active module's scheduled tasks, with a human label. Drives the topbar's
 * per-module "auto-check" line — a module with no scheduled task simply doesn't appear.
 */
export async function listModuleSchedules(): Promise<ModuleSchedule[]> {
  const raw = await getModuleSchedules();
  const out: ModuleSchedule[] = [];
  for (const s of raw) {
    if (typeof s.dailyAtMinute === "number") {
      out.push({
        module: s.module,
        kind: "daily",
        value: s.dailyAtMinute,
        label: `Daily at ${minuteOfDayToHHMM(s.dailyAtMinute)}`,
      });
    } else if (typeof s.intervalSec === "number") {
      out.push({
        module: s.module,
        kind: "interval",
        value: s.intervalSec,
        label: intervalLabel(s.intervalSec),
      });
    }
  }
  return out;
}
