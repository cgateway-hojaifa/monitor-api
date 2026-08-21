import { Like, Not } from "typeorm";
import { AppDataSource } from "@/config/data-source";
import { Category } from "@/entities/Category";
import { HealthMonitor } from "@/entities/HealthMonitor";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

/**
 * Category CRUD. Categories group Health Monitoring monitors: a monitor carries an optional
 * `category_id` and the monitor list filters by it.
 *
 * Deletion is guarded — a category still referenced by monitors is refused (409) rather than
 * silently orphaning them; the caller reassigns those monitors first. Names are unique, so the
 * uniqueness check is duplicated here (service) and by the DB index (backstop).
 */

const repo = () => AppDataSource.getRepository(Category);
const monitorRepo = () => AppDataSource.getRepository(HealthMonitor);

export interface CategoryPayload {
  name: string;
  description?: string | null;
  color?: string | null;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Normalize the optional colour: empty → null, else must be #rrggbb (stored lowercase). */
function normalizeColor(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (!COLOR_RE.test(value))
    throw new ApiError(httpStatus.BAD_REQUEST, "Color must be a hex value like #2563eb.");
  return value.toLowerCase();
}

/** Reject a name that collides with another category (case-insensitive). */
async function assertNameFree(name: string, exceptId?: number) {
  const clash = await repo().findOne({
    where: exceptId ? { name, id: Not(exceptId) } : { name },
  });
  if (clash) throw new ApiError(httpStatus.CONFLICT, "A category with that name already exists.");
}

// ── Collection ────────────────────────────────────────────────────────────────

/**
 * All categories, each with the number of monitors assigned to it. `monitor_count` drives the
 * admin table and tells the user what a delete would block on.
 */
export async function listCategories(query: { q?: unknown } = {}) {
  const q = (typeof query.q === "string" ? query.q : "").trim();
  const categories = await repo().find({
    ...(q ? { where: { name: Like(`%${q}%`) } } : {}),
    order: { name: "ASC" },
  });

  // One grouped count instead of a query per category.
  const counts = await monitorRepo()
    .createQueryBuilder("m")
    .select("m.category_id", "category_id")
    .addSelect("COUNT(*)", "count")
    .where("m.category_id IS NOT NULL")
    .groupBy("m.category_id")
    .getRawMany<{ category_id: number; count: string }>();
  const countMap = new Map(counts.map((r) => [Number(r.category_id), Number(r.count)]));

  return categories.map((c) => ({ ...c, monitor_count: countMap.get(c.id) ?? 0 }));
}

export async function createCategory(body: CategoryPayload) {
  const name = body.name?.trim();
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  await assertNameFree(name);

  const category = repo().create({
    name,
    description: body.description?.trim() || null,
    color: normalizeColor(body.color),
  });
  return repo().save(category);
}

// ── Item ──────────────────────────────────────────────────────────────────────

export async function getCategory(id: number) {
  const category = await repo().findOne({ where: { id } });
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, "Category not found.");
  const monitor_count = await monitorRepo().count({ where: { category_id: id } });
  return { ...category, monitor_count };
}

export async function updateCategory(id: number, body: CategoryPayload) {
  const category = await repo().findOne({ where: { id } });
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, "Category not found.");

  const name = body.name?.trim();
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, "Name is required.");
  await assertNameFree(name, id);

  category.name = name;
  category.description = body.description?.trim() || null;
  category.color = normalizeColor(body.color);
  return repo().save(category);
}

/**
 * Delete a category. Refuses (409) while monitors still reference it — the response names the
 * count so the UI can tell the user how many monitors to reassign.
 */
export async function deleteCategory(id: number) {
  const category = await repo().findOne({ where: { id } });
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, "Category not found.");

  const inUse = await monitorRepo().count({ where: { category_id: id } });
  if (inUse > 0)
    throw new ApiError(
      httpStatus.CONFLICT,
      `This category is assigned to ${inUse} monitor${inUse === 1 ? "" : "s"}. ` +
        `Reassign ${inUse === 1 ? "it" : "them"} before deleting.`,
    );

  await repo().remove(category);
}

/**
 * Assert a category id exists — used by the Health Monitoring service when a monitor is saved
 * with a `category_id`, so a bad id is a 400 rather than a dangling FK.
 */
export async function assertCategoryExists(id: number): Promise<void> {
  const exists = await repo().exist({ where: { id } });
  if (!exists) throw new ApiError(httpStatus.BAD_REQUEST, "Category not found.");
}
